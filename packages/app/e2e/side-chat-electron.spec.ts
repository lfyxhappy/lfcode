import { execFile } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
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

test("desktop side chat stays in-place and keeps selection drafts out of the main composer", async () => {
  test.setTimeout(120_000)
  await ensureDesktopBuild()
  const sandbox = await createDesktopSandbox()
  const llm = await createMockLlmServer(["main reply ok", "side reply ok"])
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    const client = await createDesktopClient(app)
    await client.global.config.update({
      configPatch: providerConfig(llm.url),
    })
    const created = await client.session.create({
      directory: projectDirectory,
      title: "Side Chat E2E",
    })
    const sessionID = created.data.id
    const seedText = "Selected text should stay inside the side chat draft only."
    await client.session.prompt({
      sessionID,
      directory: projectDirectory,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: seedText }],
    })

    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`
    await navigateToRoute(page, route)
    await expect(page.getByText(seedText, { exact: false })).toBeVisible({ timeout: 30_000 })
    await ensureReviewPanelOpen(page)

    const bootMarker = await readRendererBootMarker(page)

    await page.locator("#review-panel").getByRole("button", { name: /more options|更多选项/i }).first().click()
    await page.getByRole("menuitem").filter({ hasText: /side chat/i }).click()
    await expect
      .poll(() => readVisibleTabTexts(page), { timeout: 30_000 })
      .toContainEqual(expect.stringMatching(/side chat|侧边对话/i))
    await expect(page.locator('[data-component="side-chat-panel"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-component="side-chat-panel"] [role="textbox"]').first()).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(
        async () =>
          (await client.session.list({ directory: projectDirectory })).data?.some((item) => item.parentID === sessionID) ?? false,
        { timeout: 30_000 },
      )
      .toBe(true)
    expect(await readRendererBootMarker(page)).toBe(bootMarker)
    expect(await readVisiblePromptText(page)).toBe("")

    await closeActiveSideChatTab(page)
    await expect
      .poll(() => readVisibleTabTexts(page), { timeout: 30_000 })
      .not.toContainEqual(expect.stringMatching(/side chat|侧边对话/i))
    await expect
      .poll(
        async () =>
          (await client.session.list({ directory: projectDirectory })).data?.some((item) => item.parentID === sessionID) ?? false,
        { timeout: 30_000 },
      )
      .toBe(false)
    await expect(page.getByText(seedText, { exact: false })).toBeVisible({ timeout: 30_000 })
    expect(await readRendererBootMarker(page)).toBe(bootMarker)
    expect(await countVisibleSelectionAskButtons(page)).toBe(0)

    await selectMessageText(page, seedText)
    await expect(page.getByRole("button", { name: /ask in side chat|在侧边对话中询问/i })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole("button", { name: /ask in side chat|在侧边对话中询问/i }).first().click()

    await expect
      .poll(() => readVisibleTabTexts(page), { timeout: 30_000 })
      .toContainEqual(expect.stringMatching(/side chat|侧边对话/i))
    await expect
      .poll(
        async () =>
          callRendererAutomation(page, "ui.readText", {
            token: "sidechat.active.input",
          }),
        { timeout: 30_000 },
      )
      .toContain(seedText)
    await expect(
      callRendererAutomation(page, "ui.readText", {
        token: "composer.main.input",
      }),
    ).resolves.toBe("")
    expect(await readRendererBootMarker(page)).toBe(bootMarker)

    await callRendererAutomation(page, "ui.type", {
      token: "composer.main.input",
      text: "main automation ping",
    })
    await callRendererAutomation(page, "ui.click", {
      token: "composer.main.submit",
    })
    await expect(page.getByText("main automation ping", { exact: false })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("main reply ok", { exact: false })).toBeVisible({ timeout: 30_000 })

    await callRendererAutomation(page, "ui.type", {
      token: "sidechat.active.input",
      text: "side automation ping",
    })
    await callRendererAutomation(page, "ui.click", {
      token: "sidechat.active.submit",
    })
    await expect(page.locator('[data-component="side-chat-panel"]').getByText("side automation ping", { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('[data-component="side-chat-panel"]').getByText("side reply ok", { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText("side automation ping", { exact: false })).toHaveCount(1, { timeout: 30_000 })

    await closeActiveSideChatTab(page)
    await expect
      .poll(() => readVisibleTabTexts(page), { timeout: 30_000 })
      .not.toContainEqual(expect.stringMatching(/side chat|侧边对话/i))
    await expect
      .poll(
        async () =>
          (await client.session.list({ directory: projectDirectory })).data?.some((item) => item.parentID === sessionID) ?? false,
        { timeout: 30_000 },
      )
      .toBe(false)
    await expect.poll(() => readVisiblePromptText(page), { timeout: 30_000 }).toBe("")
    await expect(page.getByText(seedText, { exact: false })).toBeVisible({ timeout: 30_000 })
    expect(await readRendererBootMarker(page)).toBe(bootMarker)
    expect(await countVisibleSelectionAskButtons(page)).toBe(0)
  } finally {
    await closeApp(app)
    await llm.close()
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

async function callRendererAutomation(page: Awaited<ReturnType<typeof mainWindow>>, action: string, input?: unknown) {
  return page.evaluate(
    ([nextAction, nextInput]) => window.__LFCODE__?.automation?.call?.(nextAction, nextInput),
    [action, input ?? null] as const,
  )
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

async function ensureReviewPanelOpen(page: Awaited<ReturnType<typeof mainWindow>>) {
  const panel = page.locator("#review-panel")
  const visible = await panel.isVisible().catch(() => false)
  if (visible) return
  await page
    .locator('button[aria-label*="Review"], button[aria-label*="审查"]')
    .first()
    .click()
  await expect(panel).toBeVisible({ timeout: 30_000 })
}

async function readRendererBootMarker(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const key = "__LFCODE_SIDE_CHAT_BOOT_MARKER__"
    const win = window as typeof window & Record<string, string | undefined>
    if (!win[key]) win[key] = Math.random().toString(36).slice(2)
    return win[key]
  })
}

async function readVisiblePromptText(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[data-component="prompt-input"]')).filter((node) => {
      if (!(node instanceof HTMLElement)) return false
      const style = window.getComputedStyle(node)
      return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
    })
    const current = inputs.at(-1)
    if (!(current instanceof HTMLElement)) return ""
    return current.innerText.trim()
  })
}

async function readVisibleTabTexts(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="tab"]'))
      .filter((node) => {
        if (!(node instanceof HTMLElement)) return false
        const style = window.getComputedStyle(node)
        return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
      })
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean)
  })
}

async function countVisibleSelectionAskButtons(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button"))
      .filter((node) => {
        if (!(node instanceof HTMLElement)) return false
        const text = node.textContent ?? ""
        if (!/Ask in side chat|在侧边对话中询问/i.test(text)) return false
        const style = window.getComputedStyle(node)
        return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
      })
      .length
  })
}

async function selectMessageText(page: Awaited<ReturnType<typeof mainWindow>>, text: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((targetText) => {
          const message = Array.from(document.querySelectorAll("[data-message-id]")).find((node) =>
            (node.textContent ?? "").includes(targetText),
          )
          if (!(message instanceof HTMLElement)) return false
          const selection = window.getSelection()
          if (!selection) return false
          const range = document.createRange()
          range.selectNodeContents(message)
          selection.removeAllRanges()
          selection.addRange(range)
          document.dispatchEvent(new Event("selectionchange"))
          const rect = range.getBoundingClientRect()
          const x = rect.left + Math.min(rect.width / 2, 40)
          const y = rect.top + Math.min(rect.height / 2, 20)
          const target = document.elementFromPoint(x, y) ?? message
          target.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              clientX: x,
              clientY: y,
            }),
          )
          return (window.getSelection()?.toString() ?? "").includes(targetText)
        }, text),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function closeActiveSideChatTab(page: Awaited<ReturnType<typeof mainWindow>>) {
  const active = page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: /side chat|侧边对话/i }).first()
  await expect(active).toBeVisible({ timeout: 30_000 })
  await active.click({ button: "middle" })
}

async function createDesktopSandbox(): Promise<DesktopSandbox> {
  const root = await mkdtemp(join(tmpdir(), "lfcode-side-chat-"))
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

function providerConfig(baseURL: string) {
  return {
    model: "test/test-model",
    provider: {
      test: {
        name: "Test",
        id: "test",
        protocol: "openai-chat",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            name: "Test Model",
            limit: { context: 100_000, output: 10_000 },
            capabilities: {
              text: true,
              image: false,
              audio: false,
              video: false,
              pdf: false,
              tool_call: true,
              reasoning: false,
              native_web: false,
              temperature: true,
            },
          },
        },
        options: {
          apiKey: "test-key",
          baseURL,
        },
      },
    },
  }
}

async function createMockLlmServer(replies: string[]) {
  const queue = [...replies]
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end()
      return
    }

    const body = await readRequestBody(req)
    if (JSON.stringify(body).includes("Generate a title for this conversation")) {
      writeChatCompletion(res, "Side Chat E2E")
      return
    }

    if (req.url?.endsWith("/chat/completions")) {
      writeChatCompletion(res, queue.shift() ?? "ok")
      return
    }

    res.writeHead(404).end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error("mock llm server did not bind to a tcp port")

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return {}
  }
}

function writeChatCompletion(res: ServerResponse, text: string) {
  res.writeHead(200, { "content-type": "text/event-stream" })
  res.write(`data: ${JSON.stringify(chatChunk({ role: "assistant" }))}\n\n`)
  res.write(`data: ${JSON.stringify(chatChunk({ content: text }))}\n\n`)
  res.write(`data: ${JSON.stringify(chatChunk({}, "stop"))}\n\n`)
  res.end("data: [DONE]\n\n")
}

function chatChunk(delta: Record<string, unknown>, finish?: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta,
        ...(finish ? { finish_reason: finish } : {}),
      },
    ],
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
