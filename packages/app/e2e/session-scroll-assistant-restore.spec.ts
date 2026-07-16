import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
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

test("desktop restore keeps an assistant reply near its prior reading position", async () => {
  const sandbox = await createDesktopSandbox()
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

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1600, height: 1100 })
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

    const created = await client.session.create({
      directory: projectDirectory,
      title: "Assistant Restore E2E",
    })
    const sessionID = created.data.id
    const databasePath = await waitForDatabasePath(sandbox.lfcodeHome)
    await seedAssistantSession(client, databasePath, sessionID, 8)
    const alternate = await client.session.create({
      directory: projectDirectory,
      title: "Assistant Restore Alternate",
    })
    const alternateSessionID = alternate.data.id
    await seedAssistantSession(client, databasePath, alternateSessionID, 1)
    await page.reload({ waitUntil: "domcontentloaded" })

    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`
    const alternateRoute = `/${base64Encode(projectDirectory)}/session/${alternateSessionID}`
    await expect
      .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
      .toBe(true)
    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, route)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${route}`)
    const viewport = page.locator(".scroll-view__viewport").filter({ has: page.locator("[data-message-id]") }).first()
    await expect(viewport).toBeVisible({ timeout: 30_000 })
    const targetText = "Assistant restore seed turn 5, line 1"
    const targetMessageID = await findAssistantMessageID(client, sessionID, targetText)
    await expect
      .poll(
        async () =>
          page.evaluate(({ messageID, anchorPrefix }) => {
            const root = Array.from(document.querySelectorAll(".scroll-view__viewport")).find(
              (node) => node instanceof HTMLDivElement && node.querySelector("[data-message-id]"),
            )
            if (!(root instanceof HTMLDivElement)) return false
            return !!root.querySelector(`#${anchorPrefix}${messageID}`)
          }, { messageID: targetMessageID, anchorPrefix: "message-" }),
        { timeout: 30_000 },
      )
      .toBe(true)

    await page.evaluate(({ messageID, anchorPrefix }) => {
      const root = Array.from(document.querySelectorAll(".scroll-view__viewport")).find(
        (node) => node instanceof HTMLDivElement && node.querySelector("[data-message-id]"),
      )
      if (!(root instanceof HTMLDivElement)) throw new Error("Timeline viewport not found")
      const target = root.querySelector(`#${anchorPrefix}${messageID}`)
      if (!(target instanceof HTMLElement)) throw new Error("Target assistant message not found")
      const top = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 48
      root.scrollTo({ top, behavior: "auto" })
      root.dispatchEvent(new Event("scroll"))
    }, { messageID: targetMessageID, anchorPrefix: "message-" })

    await expect.poll(async () => offsetFromViewportTop(page, targetMessageID), { timeout: 10_000 }).toBeLessThanOrEqual(80)
    await expect
      .poll(
        async () =>
          page.evaluate(
            (sessionID) =>
              window.__LFCODE__?.debugScrollRestore?.events?.some(
                (event: any) =>
                  event?.sessionID === sessionID &&
                  (event?.type === "cache-position" || event?.type === "persist-anchored"),
              ) ?? false,
            sessionID,
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
    const before = await offsetFromViewportTop(page, targetMessageID)

    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, alternateRoute)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${alternateRoute}`)
    await expect
      .poll(async () => page.evaluate(() => window.__LFCODE__?.debugSessionMessages?.sessionID), { timeout: 30_000 })
      .toBe(alternateSessionID)

    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, route)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${route}`)
    await expect
      .poll(async () => page.evaluate(() => window.__LFCODE__?.debugSessionMessages?.sessionID), { timeout: 30_000 })
      .toBe(sessionID)

    const after = await expect
      .poll(async () => offsetFromViewportTop(page, targetMessageID), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(before - 80)
      .then(async () => {
        const settled = await offsetFromViewportTop(page, targetMessageID)
        expect(settled).toBeLessThanOrEqual(before + 80)
        return settled
      })
      .catch(async (error) => {
        console.log(JSON.stringify({
          before,
          afterRestoreDebug: await page.evaluate(() => {
            const debug = window.__LFCODE__?.debugScrollRestore as any
            return debug
              ? {
                  ...debug,
                  routeMessageHash: debug.routeMessageHash,
                  restoreRequestVersion: debug.restoreRequestVersion,
                  pendingRestoreRequest: debug.pendingRestoreRequest,
                  eventTypes: Array.isArray(debug.events) ? debug.events.map((event: any) => event?.type) : undefined,
                }
              : debug
          }),
          geometry: await page.evaluate(({ targetMessageID, anchorPrefix }) => {
            const root = Array.from(document.querySelectorAll(".scroll-view__viewport")).find(
              (node) => node instanceof HTMLDivElement && node.querySelector("[data-message-id]"),
            )
            if (!(root instanceof HTMLDivElement)) return { foundViewport: false }
            const target = root.querySelector(`#${anchorPrefix}${targetMessageID}`)
            if (!(target instanceof HTMLElement)) return { foundViewport: true, foundTarget: false }
            return {
              foundViewport: true,
              foundTarget: true,
              rootTop: root.scrollTop,
              rootHeight: root.scrollHeight,
              viewportHeight: root.clientHeight,
              targetTop: target.getBoundingClientRect().top - root.getBoundingClientRect().top,
              targetHeight: target.getBoundingClientRect().height,
            }
          }, { targetMessageID, anchorPrefix: "message-" }),
        }, null, 2))
        throw error
      })
    expect(Math.abs(after - before)).toBeLessThanOrEqual(80)
  } finally {
    await closeApp(app)
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
  }
})

async function offsetFromViewportTop(page: Awaited<ReturnType<typeof mainWindow>>, messageID: string) {
  return page.evaluate(({ targetMessageID, anchorPrefix }) => {
    const root = Array.from(document.querySelectorAll(".scroll-view__viewport")).find(
      (node) => node instanceof HTMLDivElement && node.querySelector("[data-message-id]"),
    )
    if (!(root instanceof HTMLDivElement)) throw new Error("Timeline viewport not found")
    const target = root.querySelector(`#${anchorPrefix}${targetMessageID}`)
    if (!(target instanceof HTMLElement)) throw new Error("Target assistant message not found")
    return target.getBoundingClientRect().top - root.getBoundingClientRect().top
  }, { targetMessageID: messageID, anchorPrefix: "message-" })
}

async function findAssistantMessageID(
  client: ReturnType<typeof createLfcodeClient>,
  sessionID: string,
  text: string,
) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const messages = (
      await client.session.messages({
        sessionID,
        directory: projectDirectory,
        limit: 100,
        agent_id: "*",
      })
    ).data ?? []
    const found = messages.find((message) => message.parts.some((part) => part.type === "text" && part.text.includes(text)))?.info.id
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for assistant message containing: ${text}`)
}

async function seedAssistantSession(
  client: ReturnType<typeof createLfcodeClient>,
  databasePath: string,
  sessionID: string,
  turns: number,
) {
  for (let index = 0; index < turns; index += 1) {
    const promptText = `User restore seed turn ${index + 1}: generate a long assistant reply for scroll restore testing.`
    const seeded = await client.session.prompt({
      sessionID,
      directory: projectDirectory,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: promptText }],
    })
    insertAssistantReply({
      databasePath,
      projectDirectory,
      sessionID,
      userMessageID: seeded.data.info.id,
      turn: index + 1,
    })
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (
              await client.session.messages({
                sessionID,
                directory: projectDirectory,
                limit: 100,
                agent_id: "*",
              })
            ).data ?? [],
          ),
        { timeout: 30_000 },
      )
      .toContain(`Assistant restore seed turn ${index + 1}, line 1`)
  }
}

function insertAssistantReply(input: {
  databasePath: string
  projectDirectory: string
  sessionID: string
  userMessageID: string
  turn: number
}) {
  const db = new DatabaseSync(input.databasePath)
  const now = Date.now() + input.turn
  const messageID = `msg_assistant_restore_${input.turn}_${now}`
  const partID = `part_assistant_restore_${input.turn}_${now}`

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
      modelID: "restore-e2e-model",
      providerID: "restore-e2e-provider",
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
      text: Array.from(
        { length: 14 },
        (_, line) =>
          `Assistant restore seed turn ${input.turn}, line ${line + 1}: keep this reply tall enough for mid-message restore coverage.`,
      ).join("\n"),
    }),
  )
  db.close()
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

async function mainWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  const first = await app.firstWindow()
  await first.waitForLoadState("domcontentloaded")
  await expect.poll(() => first.url(), { timeout: 30_000 }).not.toBe("")
  const readyPage = async () => {
    for (const page of app.windows()) {
      const url = page.url()
      if (!url.includes("index.html")) continue
      const ready = await page
        .evaluate(() => typeof window.api?.awaitInitialization === "function")
        .catch(() => false)
      if (ready) return page
    }
  }
  await expect
    .poll(
      async () => {
        return (await readyPage())?.url() ?? first.url()
      },
      { timeout: 30_000 },
    )
    .toContain("index.html")
  return (await readyPage()) ?? first
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
  const root = await mkdtemp(join(tmpdir(), "lfcode-assistant-restore-"))
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
