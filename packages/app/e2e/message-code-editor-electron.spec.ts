import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { test, expect, _electron as electron } from "@playwright/test"
import { createLfcodeClient } from "@lfcode-ai/sdk/v2/client"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { ensureDesktopBuild } from "./desktop-build"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const projectDirectory = root.replaceAll("/", "\\")
const execFileAsync = promisify(execFile)

type DesktopSandbox = {
  root: string
  profileDir: string
  roamingAppData: string
  localAppData: string
  lfcodeHome: string
  appData: string
}

test("desktop session automation can drive timeline code block editing and open the saved scratch file", async () => {
  test.setTimeout(120_000)
  await ensureDesktopBuild()
  const sandbox = await createDesktopSandbox()
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    await enableExperimentalCodeEditor(page)

    const client = await createDesktopClient(app)
    const created = await client.session.create({
      directory: projectDirectory,
      title: "Message Code Editor E2E",
    })
    const sessionID = created.data.id
    const seeded = await client.session.prompt({
      sessionID,
      directory: projectDirectory,
      agent: "build",
      model: {
        providerID: "test",
        modelID: "test-model",
      },
      noReply: true,
      parts: [
        {
          type: "text",
          text: "Show me an editable TypeScript snippet.",
        },
      ],
    })

    const databasePath = await waitForDatabasePath(sandbox.lfcodeHome)
    const seededBlock = insertAssistantCodeMessage({
      databasePath,
      projectDirectory,
      sessionID,
      userMessageID: seeded.data.info.id,
      text: [
        "Here is a TypeScript example:",
        "",
        "```ts",
        'export const messageValue = 1',
        'export const messageLabel = "seed"',
        "```",
      ].join("\n"),
    })

    await expect
      .poll(
        async () =>
          JSON.stringify(
            (
              await client.session.messages({
                sessionID,
                directory: projectDirectory,
                limit: 20,
                agent_id: "*",
              })
            ).data ?? [],
          ),
        { timeout: 30_000 },
      )
      .toContain("```ts")

    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`
    await navigateToRoute(page, route)

    await expect
      .poll(
        async () =>
          (await readRendererSessionState(page))?.messageBlocks?.find(
            (item: { blockKey?: string }) => item.blockKey === seededBlock.blockKey,
          ),
        { timeout: 30_000 },
      )
      .toBeTruthy()
    const messageBlock = await readRendererSessionState(page).then(
      (state) => state?.messageBlocks?.find((item: { blockKey?: string }) => item.blockKey === seededBlock.blockKey),
    )
    if (!messageBlock?.path) throw new Error("Message code block path is not available")

    await callRendererAutomation(page, "ui.click", {
      token: "messageblock.mode.edit",
      blockKey: seededBlock.blockKey,
    })
    await expect
      .poll(
        async () =>
          (await readRendererSessionState(page))?.messageBlocks?.find(
            (item: { blockKey?: string }) => item.blockKey === seededBlock.blockKey,
          )?.editor?.implementation,
        { timeout: 30_000 },
      )
      .toBe("phase0")

    const updated = [
      "export const messageValue = 2",
      'export const messageLabel = "edited-from-message-block"',
      "",
    ].join("\n")
    const boundPath = "packages/app/e2e/.tmp-message-code-block-bound.ts"

    const edited = await callRendererAutomation(page, "ui.type", {
      token: "messageblock.editor",
      blockKey: seededBlock.blockKey,
      text: updated,
    })
    expect(edited.value).toBe(updated)

    const rebound = await callRendererAutomation(page, "messageblock.bindFileToPath", {
      blockKey: seededBlock.blockKey,
      path: boundPath,
    })
    expect(rebound.saved).toBe(true)
    expect(rebound.block.path).toBe(boundPath)

    const savedPath = resolve(projectDirectory, boundPath)
    await expect
      .poll(async () => (await readFile(savedPath, "utf8")).replace(/\r\n/g, "\n"), { timeout: 30_000 })
      .toBe(updated)

    await callRendererAutomation(page, "ui.click", {
      token: "messageblock.mode.open-sidebar",
      blockKey: seededBlock.blockKey,
    })
    await expect
      .poll(async () => (await readRendererSessionState(page))?.fileTab?.path, { timeout: 30_000 })
      .toBe(boundPath)

    const localDraft = [
      "export const messageValue = 3",
      'export const messageLabel = "local-dirty-change"',
      "",
    ].join("\n")
    const dirtied = await callRendererAutomation(page, "ui.type", {
      token: "messageblock.editor",
      blockKey: seededBlock.blockKey,
      text: localDraft,
    })
    expect(dirtied.value).toBe(localDraft)

    const external = [
      "export const messageValue = 9",
      'export const messageLabel = "external-change"',
      "",
    ].join("\n")
    await writeFile(savedPath, external)
    await callRendererAutomation(page, "ui.click", {
      token: "messageblock.mode.reload",
      blockKey: seededBlock.blockKey,
    })
    await expect
      .poll(
        async () =>
          (await readRendererSessionState(page))?.messageBlocks?.find(
            (item: { blockKey?: string }) => item.blockKey === seededBlock.blockKey,
          )?.editor?.value,
        { timeout: 30_000 },
      )
      .toBe(external)
  } finally {
    await closeApp(app)
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
  }
})

async function launchDesktop(appData: DesktopSandbox) {
  return electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      APPDATA: appData.roamingAppData,
      LOCALAPPDATA: appData.localAppData,
      USERPROFILE: appData.profileDir,
      LFCODE_HOME: appData.lfcodeHome,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_USER_DATA_DIR: appData.appData,
    },
  })
}

async function createDesktopClient(app: Awaited<ReturnType<typeof electron.launch>>) {
  const page = await mainWindow(app)
  const sidecar = await page.evaluate(() => window.api.awaitInitialization(() => undefined))
  return createLfcodeClient({
    baseUrl: sidecar.url,
    headers: sidecar.password
      ? {
          Authorization: `Basic ${Buffer.from(`${sidecar.username ?? "lfcode"}:${sidecar.password}`).toString("base64")}`,
        }
      : undefined,
    directory: projectDirectory,
    throwOnError: true,
  })
}

async function navigateToRoute(page: Awaited<ReturnType<typeof mainWindow>>, route: string) {
  await expect
    .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
    .toBe(true)
  await page.evaluate((next) => {
    window.__LFCODE__?.navigate?.(next)
  }, route)
  await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${route}`)
}

async function callRendererAutomation(page: Awaited<ReturnType<typeof mainWindow>>, action: string, input?: unknown) {
  return page.evaluate(
    ([nextAction, nextInput]) => window.__LFCODE__?.automation?.call?.(nextAction, nextInput),
    [action, input ?? null] as const,
  )
}

function readRendererSessionState(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(async () => {
    const state = await window.__LFCODE__?.automation?.getState?.()
    return (state as { session?: unknown } | undefined)?.session as any
  })
}

async function enableExperimentalCodeEditor(page: Awaited<ReturnType<typeof mainWindow>>) {
  const enabled = await page.evaluate(() => localStorage.getItem("lfcode.experimental.monaco-editor"))
  if (enabled === "true" || enabled === "1") return
  await page.evaluate(() => {
    localStorage.setItem("lfcode.experimental.monaco-editor", "true")
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect
    .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
    .toBe(true)
}

async function createDesktopSandbox(): Promise<DesktopSandbox> {
  const root = await mkdtemp(join(tmpdir(), "lfcode-message-code-editor-"))
  const profileDir = join(root, "profile")
  const roamingAppData = join(profileDir, "AppData", "Roaming")
  const localAppData = join(profileDir, "AppData", "Local")
  const appData = join(roamingAppData, "com.lfyxhappy.lfcode.dev")
  const lfcodeHome = join(root, "lfcode-home")
  const project = {
    id: "project-lfcode",
    worktree: projectDirectory,
    vcs: "git",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
    sandboxes: [],
  }

  await Promise.all([
    mkdir(roamingAppData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(appData, { recursive: true }),
    mkdir(lfcodeHome, { recursive: true }),
  ])
  await writeFile(
    join(appData, "lfcode.global.dat"),
    JSON.stringify({
      "globalSync.project": JSON.stringify({ value: [project] }),
    }),
  )

  return {
    root,
    profileDir,
    roamingAppData,
    localAppData,
    lfcodeHome,
    appData,
  }
}

async function waitForDatabasePath(lfcodeHome: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const found = await findDatabasePath(join(lfcodeHome, "data"))
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for database under ${lfcodeHome}`)
}

async function findDatabasePath(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findDatabasePath(full)
      if (nested) return nested
      continue
    }
    if (/^lfcode.*\.db$/i.test(entry.name)) return full
  }
}

function insertAssistantCodeMessage(input: {
  databasePath: string
  projectDirectory: string
  sessionID: string
  userMessageID: string
  text: string
}) {
  const db = new DatabaseSync(input.databasePath)
  const now = Date.now()
  const messageID = `msg_e2e_${now}`
  const partID = `prt_e2e_${now}`
  const blockKey = `${input.sessionID}:${messageID}:${partID}:0`

  db.exec("PRAGMA busy_timeout = 5000")
  db.prepare(
    `
      insert into message (id, session_id, agent_id, time_created, time_updated, data)
      values (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    messageID,
    input.sessionID,
    "main",
    now,
    now,
    JSON.stringify({
      role: "assistant",
      parentID: input.userMessageID,
      mode: "build",
      agent: "build",
      path: {
        cwd: input.projectDirectory,
        root: input.projectDirectory,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      modelID: "test-model",
      providerID: "test",
      time: {
        created: now,
        completed: now,
      },
      finish: "stop",
    }),
  )
  db.prepare(
    `
      insert into part (id, message_id, session_id, time_created, time_updated, data)
      values (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    partID,
    messageID,
    input.sessionID,
    now,
    now,
    JSON.stringify({
      type: "text",
      text: input.text,
    }),
  )
  db.close()
  return {
    messageID,
    partID,
    blockKey,
  }
}

async function mainWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  const first = await app.firstWindow()
  await first.waitForLoadState("domcontentloaded")
  await expect.poll(() => first.url(), { timeout: 30_000 }).not.toBe("")
  if (first.url().includes("index.html")) return first
  const existing = app.windows().find((page) => page.url().includes("index.html"))
  if (existing) return existing
  await expect
    .poll(
      () => app.windows().find((page) => page.url().includes("index.html"))?.url() ?? first.url(),
      { timeout: 30_000 },
    )
    .toContain("index.html")
  return app.windows().find((page) => page.url().includes("index.html")) ?? first
}

async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>) {
  const child = (() => {
    try {
      return app.process()
    } catch {
      return
    }
  })()
  try {
    await app.evaluate(({ app }) => app.quit())
  } catch {}
  if (!child) return
  await waitForExit(child.pid, 5_000)
  if (await isPidRunning(child.pid)) {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => undefined)
    } else {
      child.kill("SIGKILL")
    }
  }
  await waitForExit(child.pid, 5_000)
}

async function waitForExit(pid: number, timeout: number) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (!(await isPidRunning(pid))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
