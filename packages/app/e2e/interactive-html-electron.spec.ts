import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { test, expect, _electron as electron } from "@playwright/test"
import { createLfcodeClient } from "@lfcode-ai/sdk/v2/client"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { ensureDesktopBuild } from "./desktop-build"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const projectDirectory = root.replaceAll("/", "\\")

test.describe.configure({ timeout: 240_000 })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  await ensureDesktopBuild()
})

const interactiveHtmlBlock = [
  "```lfcode-html title=\"Interactive test\" height=220",
  "<!doctype html>",
  "<html>",
  "<body>",
  "<button id=\"pick\">Pick alpha</button>",
  "<script>",
  "document.getElementById(\"pick\").addEventListener(\"click\", () => {",
  "  parent.postMessage({ type: \"lfcode.component.event\", event: \"pick_option\", payload: { value: \"alpha\" }, state: { selected: \"alpha\" } }, \"*\")",
  "})",
  "</script>",
  "</body>",
  "</html>",
  "```",
].join("\n")

test("desktop interactive html component renders and sends a follow-up message", async () => {
  const sandbox = await createDesktopSandbox()
  const llm = await createMockLlmServer(["follow-up ok"])
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      APPDATA: sandbox.roamingAppData,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_HOME: sandbox.lfcodeHome,
      LOCALAPPDATA: sandbox.localAppData,
      USERPROFILE: sandbox.profileDir,
    },
  })
  const logDir = await app.evaluate(({ app }) => app.getPath("logs"))

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    const sidecar = await page.evaluate(() => window.api.awaitInitialization(() => undefined))
    const client = createLfcodeClient({
      baseUrl: sidecar.url,
      headers: sidecar.password
        ? {
            Authorization: `Basic ${Buffer.from(`${sidecar.username ?? "lfcode"}:${sidecar.password}`).toString("base64")}`,
          }
        : undefined,
      directory: projectDirectory,
      throwOnError: true,
    })

    await client.global.config.update({
      configPatch: providerConfig(llm.url),
    })

    const created = await client.session.create({
      directory: projectDirectory,
      title: "Interactive HTML E2E",
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
          text: "Render the interactive component.",
        },
      ],
    })
    const databasePath = await waitForDatabasePath(sandbox.lfcodeHome)
    insertAssistantHtmlMessage({
      databasePath,
      projectDirectory,
      sessionID,
      userMessageID: seeded.data.info.id,
      text: interactiveHtmlBlock,
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
      .toContain("```lfcode-html")

    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`
    await expect
      .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
      .toBe(true)
    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, route)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${route}`)

    const component = page.locator('[data-component="lfcode-html-frame"]')
    await expect(component).toHaveCount(1, { timeout: 30_000 })
    await expect(component.locator('[data-slot="lfcode-html-title"]')).toHaveText("Interactive test", {
      timeout: 30_000,
    })

    const frame = component.locator('iframe[data-slot="lfcode-html-iframe"]').first()
    await expect(frame).toBeVisible({ timeout: 30_000 })
    const body = frame.contentFrame()
    await expect(body.getByRole("button", { name: "Pick alpha" })).toBeVisible({ timeout: 30_000 })
    await body.getByRole("button", { name: "Pick alpha" }).click()

    await expect(
      page.getByText("[组件交互: Interactive test]", { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText("event: pick_option", { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText('payload: {"value":"alpha"}', { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText('state: {"selected":"alpha"}', { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
  } catch (error) {
    await dumpDesktopLogs(logDir)
    throw error
  } finally {
    await closeApp(app)
    await llm.close()
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
  }
})

function providerConfig(baseURL: string) {
  return {
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
      writeChatCompletion(res, "Interactive HTML E2E")
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

function insertAssistantHtmlMessage(input: {
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
}

async function dumpDesktopLogs(logDir: string) {
  try {
    const files = await readdir(logDir)
    for (const name of files) {
      const full = join(logDir, name)
      const content = await readFile(full, "utf8").catch(() => "")
      if (!content) continue
      console.log(`[interactive-html log] ${name}`)
      console.log(content.slice(-8000))
    }
  } catch (error) {
    console.log("[interactive-html log] failed", error)
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
      () =>
        app.windows().find((page) => page.url().includes("index.html"))?.url() ??
        first.url(),
      { timeout: 30_000 },
    )
    .toContain("index.html")
  return app.windows().find((page) => page.url().includes("index.html")) ?? first
}

async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>) {
  const child = app.process()
  try {
    await app.evaluate(({ app }) => app.quit())
  } catch {}
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      process.kill(child.pid, 0)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch {
      return
    }
  }
}

async function createDesktopSandbox() {
  const root = await mkdtemp(join(tmpdir(), "lfcode-interactive-html-"))
  const profileDir = join(root, "profile")
  const roamingAppData = join(profileDir, "AppData", "Roaming")
  const localAppData = join(profileDir, "AppData", "Local")
  const userDataDir = join(roamingAppData, "com.lfyxhappy.lfcode.dev")
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
    mkdir(userDataDir, { recursive: true }),
    mkdir(lfcodeHome, { recursive: true }),
  ])
  await writeFile(
    join(userDataDir, "lfcode.global.dat"),
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
  }
}
