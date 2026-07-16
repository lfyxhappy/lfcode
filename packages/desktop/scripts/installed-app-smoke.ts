#!/usr/bin/env bun

import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { createAutomationClient } from "./automation-client"

type AutomationClient = Awaited<ReturnType<typeof createAutomationClient>>

type AutomationUiState = {
  route?: string
  session?: {
    sessionID?: string
    sessionKey?: string
    directory?: string
    sideChat?: {
      activeSessionID?: string
      items?: Array<{
        tab: string
        sessionID: string
      }>
    }
    browser?: {
      activeTabID?: string
      items?: Array<{
        id: string
        url: string
        title?: string
        loading?: boolean
      }>
    }
    composer?: {
      activeTarget?: string
      mainText?: string
      activeText?: string
    }
    tabs?: {
      active?: string
      all?: string[]
    }
    fileTab?: {
      path?: string
      editor?: {
        implementation?: string
        language?: string
        value?: string
      }
    }
  } | null
}

type SessionOpenResult = {
  sessionID?: string
  sessionKey?: string
}

type BrowserOpenResult = {
  state?: AutomationUiState["session"]
}

type UiNodeSnapshot = {
  focused?: boolean
  dataset?: Record<string, string>
  rect?: {
    x: number
    y: number
    width: number
    height: number
  }
}

const repoRoot = resolve(import.meta.dir, "../../..")
const desktopRoot = resolve(import.meta.dir, "..")
const defaultDirectory = resolve(process.env.LFCODE_AUTOMATION_DIRECTORY || repoRoot)
const defaultExePath = resolve(desktopRoot, "dist", "win-unpacked", "Lfcode.exe")
const exePath = resolve(process.env.LFCODE_SMOKE_EXE || defaultExePath)
const automationPort = await resolveAutomationPort()
const automationToken = process.env.LFCODE_AUTOMATION_TOKEN || `installed-smoke-${randomUUID()}`
const portableRoot = resolve(
  process.env.LFCODE_SMOKE_PORTABLE_ROOT || join(repoRoot, ".tmp-installed-smoke", randomUUID()),
)
const sideChatSeed = process.env.LFCODE_AUTOMATION_SIDECHAT_TEXT || "请简单确认你已收到这条侧边对话测试消息。"
const sideChatPrompt = process.env.LFCODE_AUTOMATION_SIDECHAT_PROMPT || "请回复：sidechat smoke ok"

let desktop: Bun.Subprocess | undefined
let desktopLogs = ""
let spawnedPid: number | undefined

try {
  await mkdir(portableRoot, { recursive: true })
  desktop = spawnPackagedDesktop({
    exePath,
    automationPort,
    automationToken,
    portableRoot,
  })
  spawnedPid = desktop.pid
  captureDesktopLogs(desktop)

  const client = await createAutomationClient({
    host: "127.0.0.1",
    port: automationPort,
    token: automationToken,
  })

  const health = await waitForHealth(client)
  const windows = await client.get<Array<{ id: number; title: string; focused: boolean }>>("/windows")
  if (windows.length === 0) throw new Error("No packaged desktop window is available for smoke")
  const windowID = windows[0].id

  const route = `/${base64Encode(defaultDirectory.replace(/\\/g, "/"))}/session`
  await client.post("/route/navigate", { windowID, route })
  const routeState = await waitForUiState(client, windowID, (ui) => ui.route === route && !!ui.session)

  const sessionID = process.env.LFCODE_AUTOMATION_SESSION_ID || routeState.session?.sessionID || ""
  const opened = sessionID
    ? await client.post<SessionOpenResult>("/session/open", {
        windowID,
        directory: defaultDirectory,
        sessionID,
      })
    : await client.post<SessionOpenResult>("/session/create", {
        windowID,
        title: "Installed Smoke Session",
        open: true,
      })
  const targetSessionID = opened.sessionID || sessionID
  if (!targetSessionID) throw new Error("session.create did not return a session id")
  const sessionState = await waitForUiState(
    client,
    windowID,
    (ui) => ui.session?.sessionID === targetSessionID,
  )

  const editor = await runEditorInputSmoke(client, windowID, portableRoot)

  await client.post("/sidechat/create", {
    windowID,
    text: sideChatSeed,
  })
  const sideChatState = await waitForUiState(
    client,
    windowID,
    (ui) => (ui.session?.sideChat?.items?.length ?? 0) >= 1,
  )
  const sideSessionID = sideChatState.session?.sideChat?.activeSessionID ?? sideChatState.session?.sideChat?.items?.[0]?.sessionID
  if (!sideSessionID) throw new Error("sidechat.create did not expose a side session id")

  await client.post("/composer/set-text", {
    windowID,
    target: "active-side",
    sessionID: sideSessionID,
    text: sideChatPrompt,
  })
  const composerState = await waitForUiState(
    client,
    windowID,
    (ui) => ui.session?.composer?.activeTarget === sideSessionID && (ui.session?.composer?.activeText ?? "").includes(sideChatPrompt),
  )

  await client.post("/browser/open", {
    windowID,
    url: "https://example.com/",
    title: "Installed Smoke Browser",
  })
  const browserState = await waitForUiState(
    client,
    windowID,
    (ui) => (ui.session?.browser?.items?.length ?? 0) >= 1,
  )
  const browserTab = browserState.session?.browser?.items?.find((item) => item.url.includes("example.com"))
  if (!browserTab) throw new Error("browser.open did not create the expected tab")

  const uiState = await client.get<{ state: AutomationUiState }>(`/diagnostics/ui-state?windowID=${windowID}`)

  console.log(
    JSON.stringify(
      {
        ok: true,
        exePath,
        portableRoot,
        health,
        windowID,
        route,
        session: {
          requestedSessionID: sessionID || undefined,
          openedSessionID: targetSessionID,
          sessionKey: opened.sessionKey ?? sessionState.session?.sessionKey,
        },
        editor,
        sideChat: {
          activeSessionID: sideSessionID,
          count: sideChatState.session?.sideChat?.items?.length ?? 0,
          composerTarget: composerState.session?.composer?.activeTarget,
        },
        browser: {
          activeTabID: browserState.session?.browser?.activeTabID,
          tabCount: browserState.session?.browser?.items?.length ?? 0,
          openedURL: browserTab.url,
        },
        uiState: uiState.state,
      },
      null,
      2,
    ),
  )
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (desktopLogs.trim()) {
    console.error("[installed-app-smoke] desktop logs")
    console.error(desktopLogs.slice(-20_000))
  }
  throw new Error(detail, { cause: error })
} finally {
  if (desktop && desktop.exitCode === null) {
    desktop.kill()
    await desktop.exited.catch(() => undefined)
  }
  await cleanupPackagedProcesses(exePath, spawnedPid).catch(() => undefined)
  if (!process.env.LFCODE_SMOKE_KEEP_ROOT) {
    await rm(portableRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

function spawnPackagedDesktop(input: {
  exePath: string
  automationPort: number
  automationToken: string
  portableRoot: string
}) {
  return Bun.spawn({
    cmd: [input.exePath, `--automation-port=${input.automationPort}`, `--automation-token=${input.automationToken}`],
    cwd: dirname(input.exePath),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LFCODE_AUTOMATION: "1",
      LFCODE_AUTOMATION_PORT: String(input.automationPort),
      LFCODE_AUTOMATION_TOKEN: input.automationToken,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_PORTABLE_ROOT: input.portableRoot,
    },
  })
}

function captureDesktopLogs(proc: Bun.Subprocess) {
  void streamToString(proc.stdout).then((text) => {
    desktopLogs += text
  })
  void streamToString(proc.stderr).then((text) => {
    desktopLogs += text
  })
}

async function streamToString(stream: ReadableStream<Uint8Array> | number | null) {
  if (!stream || typeof stream === "number") return ""
  return await new Response(stream).text()
}

async function waitForHealth(client: AutomationClient) {
  const startedAt = Date.now()
  let lastError = ""
  while (Date.now() - startedAt < 90_000) {
    try {
      return await client.get<{
        status: string
      }>("/health")
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await delay(500)
    }
  }
  throw new Error(`Timed out waiting for packaged automation health endpoint: ${lastError}`)
}

async function waitForUiState(
  client: AutomationClient,
  windowID: number,
  predicate: (state: AutomationUiState) => boolean,
  label = "packaged renderer automation state",
) {
  const startedAt = Date.now()
  let lastState: AutomationUiState | undefined
  while (Date.now() - startedAt < 30_000) {
    const payload = await client.get<{ state: AutomationUiState }>(`/diagnostics/ui-state?windowID=${windowID}`)
    lastState = payload.state
    if (predicate(payload.state)) return payload.state
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastState)}`)
}

async function resolveAutomationPort() {
  const fromEnv = Number(process.env.LFCODE_AUTOMATION_PORT || "0")
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return await getAvailablePort()
}

async function getAvailablePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address !== "object") {
        server.close()
        reject(new Error("Failed to allocate automation port"))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function runEditorInputSmoke(client: AutomationClient, windowID: number, fixtureRoot: string) {
  const cppPath = join(fixtureRoot, "editor-input-probe.cpp")
  const tsPath = join(fixtureRoot, "editor-input-probe.ts")
  await Promise.all([
    writeFile(cppPath, '#include <iostream>\n\nint main() {\n  return 0;\n}\n', "utf8"),
    writeFile(tsPath, 'const account = { name: "Lfcode" }\n\naccount.\n', "utf8"),
  ])

  await openEditor(client, windowID, cppPath)
  await client.post("/ui/editor", {
    windowID,
    token: "filetab.active.editor",
    action: "setSelection",
    selection: {
      startLineNumber: 6,
      startColumn: 1,
      endLineNumber: 6,
      endColumn: 1,
    },
  })
  await client.post("/ui/editor", { windowID, token: "filetab.active.editor", action: "focus" })
  await client.post("/window/type", { windowID, text: "alpha\n\tbeta" })
  const cpp = await waitForUiState(
    client,
    windowID,
    (ui) => ui.session?.fileTab?.editor?.value?.includes("alpha") === true && ui.session?.fileTab?.editor?.value?.includes("beta") === true,
    "C++ editor keyboard input",
  )

  await openEditor(client, windowID, tsPath)
  await client.post("/ui/editor", {
    windowID,
    token: "filetab.active.editor",
    action: "setSelection",
    selection: {
      startLineNumber: 3,
      startColumn: 9,
      endLineNumber: 3,
      endColumn: 9,
    },
  })
  await client.post("/ui/editor", { windowID, token: "filetab.active.editor", action: "triggerSuggest" })
  await client.post("/ui/editor", { windowID, token: "filetab.active.editor", action: "focus" })
  await client.post("/ui/editor", {
    windowID,
    token: "filetab.active.editor",
    action: "setSelection",
    selection: {
      startLineNumber: 3,
      startColumn: 9,
      endLineNumber: 3,
      endColumn: 9,
    },
  })
  await delay(100)
  await client.post("/ui/editor", { windowID, token: "filetab.active.editor", action: "focus" })
  await client.post("/window/type", { windowID, text: "name" })
  const typescript = await waitForUiState(
    client,
    windowID,
    (ui) => ui.session?.fileTab?.editor?.value?.includes("account.name") === true,
    "TypeScript editor keyboard input",
  )

  const commandMenuTarget = await client.post<UiNodeSnapshot>("/ui/query", {
    windowID,
    token: "filetab.active.command-menu",
  })
  if (!commandMenuTarget.rect) throw new Error("editor command menu did not expose a clickable rectangle")
  await client.post("/ui/click", { windowID, token: "filetab.active.command-menu" })
  await delay(250)
  const openedMenu = await client.post<UiNodeSnapshot>("/ui/query", {
    windowID,
    token: "filetab.active.command-menu",
  })
  const commandMenuOpened = "expanded" in (openedMenu.dataset ?? {})
  const composerTarget = await client.post<UiNodeSnapshot>("/ui/query", {
    windowID,
    token: "composer.main.input",
  })
  const composerResult = await (async () => {
    if (commandMenuOpened) {
      await clickSnapshot(client, windowID, composerTarget, "composer input")
      await delay(250)
      const composer = await client.post<UiNodeSnapshot>("/ui/query", {
        windowID,
        token: "composer.main.input",
      })
      if (!composer.focused) {
        throw new Error(`Composer did not regain focus after editor interaction: ${JSON.stringify(composer)}`)
      }
      await client.post("/window/type", { windowID, text: "focusback" })
      return {
        composer,
        focused: await waitForUiState(
          client,
          windowID,
          (ui) => ui.session?.composer?.mainText === "focusback",
          "composer focus return keyboard input",
        ),
      }
    }
    await client.post("/composer/set-text", { windowID, target: "main", text: "focusback" })
    return {
      composer: await client.post<UiNodeSnapshot>("/ui/query", {
        windowID,
        token: "composer.main.input",
      }),
      focused: await waitForUiState(
        client,
        windowID,
        (ui) => ui.session?.composer?.mainText === "focusback",
        "composer state fallback",
      ),
    }
  })()

  const events = await client.get<Array<{ scope?: string; type?: string; data?: unknown }>>("/diagnostics/events?limit=500")
  const missingServices = events.filter((event) =>
    /UNKNOWN service|ISuggestMemories|ICodeLensCache|IInlayHintsCache|actionWidgetService|treeViewsDndService/.test(
      JSON.stringify(event.data ?? ""),
    ),
  )
  if (missingServices.length > 0) throw new Error(`Renderer reported missing Monaco services: ${JSON.stringify(missingServices)}`)

  return {
    cpp: {
      language: cpp.session?.fileTab?.editor?.language,
      value: cpp.session?.fileTab?.editor?.value,
      typedLetters: cpp.session?.fileTab?.editor?.value?.includes("alpha") === true,
      typedEnterAndTab: /alpha\r?\n[\t ]+beta/.test(cpp.session?.fileTab?.editor?.value ?? ""),
    },
    typescript: {
      language: typescript.session?.fileTab?.editor?.language,
      value: typescript.session?.fileTab?.editor?.value,
    },
    composer: {
      focused: composerResult.composer.focused === true,
      value: composerResult.focused.session?.composer?.mainText,
    },
    commandMenu: {
      opened: commandMenuOpened,
      manualFocusVerificationRequired: !commandMenuOpened,
    },
    missingServiceErrors: missingServices.length,
  }
}

async function clickSnapshot(client: AutomationClient, windowID: number, snapshot: UiNodeSnapshot, label: string) {
  if (!snapshot.rect) throw new Error(`${label} did not expose a clickable rectangle`)
  await client.post("/window/click", {
    windowID,
    x: Math.round(snapshot.rect.x + snapshot.rect.width / 2),
    y: Math.round(snapshot.rect.y + snapshot.rect.height / 2),
  })
}

async function openEditor(client: AutomationClient, windowID: number, path: string) {
  const expectedPath = resolve(path).replaceAll("/", "\\").toLowerCase()
  await client.post("/filetab/open-path", { windowID, path })
  await client.post("/filetab/mode", { windowID, mode: "edit" })
  await waitForUiState(
    client,
    windowID,
    (ui) =>
      !!ui.session?.fileTab?.path &&
      resolve(defaultDirectory, ui.session.fileTab.path).replaceAll("/", "\\").toLowerCase() === expectedPath &&
      ui.session.fileTab.editor?.implementation === "phase0",
    `editor initialization for ${path}`,
  )
}

async function cleanupPackagedProcesses(targetExePath: string, rootPid?: number) {
  const normalizedExePath = targetExePath.toLowerCase()
  const proc = Bun.spawn(
    [
      "pwsh",
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const list = await streamToString(proc.stdout)
  await proc.exited
  const rows = JSON.parse(list || "[]") as
    | { ProcessId?: number; ParentProcessId?: number; ExecutablePath?: string }[]
    | { ProcessId?: number; ParentProcessId?: number; ExecutablePath?: string }
  const processes = Array.isArray(rows) ? rows : [rows]
  const byPid = new Map(
    processes
      .filter((item) => typeof item.ProcessId === "number")
      .map((item) => [item.ProcessId as number, item]),
  )
  const matched = new Set<number>()
  for (const item of processes) {
    if (typeof item.ProcessId !== "number") continue
    const executablePath = item.ExecutablePath?.toLowerCase()
    if (executablePath === normalizedExePath) matched.add(item.ProcessId)
  }
  if (rootPid && byPid.has(rootPid)) matched.add(rootPid)
  let changed = true
  while (changed) {
    changed = false
    for (const item of processes) {
      if (typeof item.ProcessId !== "number" || typeof item.ParentProcessId !== "number") continue
      if (!matched.has(item.ParentProcessId) || matched.has(item.ProcessId)) continue
      matched.add(item.ProcessId)
      changed = true
    }
  }
  for (const pid of Array.from(matched)) {
    if (!Number.isFinite(pid) || pid <= 0) continue
    await Bun.spawn(["pwsh", "-NoLogo", "-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited
  }
}
