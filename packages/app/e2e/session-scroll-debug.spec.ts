import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
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

test("desktop session scroll can leave bottom and restore prior reading position", async () => {
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
      title: "Scroll Restore E2E",
    })
    const sessionID = created.data.id
    await seedLongSession(client, sessionID)
    const alternate = await client.session.create({
      directory: projectDirectory,
      title: "Scroll Restore Alternate",
    })
    const alternateSessionID = alternate.data.id
    await seedLongSession(client, alternateSessionID, 2)

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
    await expect.poll(() => activeTimelineSessionID(page), { timeout: 30_000 }).toBe(sessionID)
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
      .toContain("Scroll restore seed turn 1")

    const viewport = page.locator(".scroll-view__viewport").filter({ has: page.locator("[data-message-id]") }).first()
    await expect(viewport).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await timelineMetrics(page)).maxScrollTop, { timeout: 30_000 })
      .toBeGreaterThan(500)

    const initial = await timelineMetrics(page)
    await viewport.hover()
    await page.mouse.wheel(0, -1400)
    await expect
      .poll(async () => (await timelineMetrics(page)).scrollTop, { timeout: 10_000 })
      .toBeLessThan(initial.maxScrollTop - 200)

    const afterScrollUp = await timelineMetrics(page)
    expect(afterScrollUp.topMessage?.id).toBeTruthy()
    await page.waitForTimeout(1200)
    const settled = await timelineMetrics(page)
    expect(settled.scrollTop).toBeLessThan(settled.maxScrollTop - 20)
    expect(extractTurn(settled.topMessage?.text)).toBeLessThanOrEqual(extractTurn(afterScrollUp.topMessage?.text))

    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, alternateRoute)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${alternateRoute}`)
    await expect.poll(() => activeTimelineSessionID(page), { timeout: 30_000 }).toBe(alternateSessionID)

    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, route)
    await expect
      .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
      .toBe(`#${route}`)
    await expect.poll(() => activeTimelineSessionID(page), { timeout: 30_000 }).toBe(sessionID)

    const restored = await timelineMetrics(page)
    expect(restored.scrollTop).toBeLessThan(restored.maxScrollTop - 20)
    expect(Math.abs(scrollRatio(restored) - scrollRatio(settled))).toBeLessThanOrEqual(0.25)
  } finally {
    await closeApp(app)
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
  }
})

async function timelineMetrics(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(".scroll-view__viewport"))
      .filter((node): node is HTMLDivElement => node instanceof HTMLDivElement)
      .map((node) => ({
        className: node.className,
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        maxScrollTop: Math.max(0, node.scrollHeight - node.clientHeight),
        messages: node.querySelectorAll("[data-message-id]").length,
        topMessage: (() => {
          const box = node.getBoundingClientRect()
          const line = box.top + 40
          const items = Array.from(node.querySelectorAll("[data-message-id]"))
            .filter((item): item is HTMLElement => item instanceof HTMLElement)
            .map((item) => ({
              id: item.dataset.messageId,
              text: item.textContent ?? "",
              top: item.getBoundingClientRect().top,
              bottom: item.getBoundingClientRect().bottom,
            }))
            .filter((item): item is { id: string; text: string; top: number; bottom: number } => !!item.id)
          const shown = items.filter((item) => item.bottom > box.top && item.top < box.bottom)
          const hit = shown.find((item) => item.top <= line && item.bottom >= line)
          if (hit) return hit
          const near = [...shown].sort((a, b) => {
            const da = Math.abs(a.top - line)
            const db = Math.abs(b.top - line)
            if (da !== db) return da - db
            return a.top - b.top
          })[0]
          if (near) return near
          return items.filter((item) => item.top <= line).at(-1) ?? items[0]
        })(),
      }))
      .filter((node) => node.messages > 0 && node.scrollHeight > node.clientHeight + 10)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)

    if (candidates.length === 0) throw new Error("No scrollable viewport found")
    return candidates[0]
  })
}

async function activeTimelineSessionID(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() =>
    document.querySelector<HTMLElement>("[data-component=session-timeline-host] > div:not(.hidden) [data-session-id]")?.dataset
      .sessionId,
  )
}

function extractTurn(text?: string) {
  const match = text?.match(/Scroll restore seed turn (\d+)/)
  return match ? Number(match[1]) : -1
}

function scrollRatio(input: { scrollTop: number; maxScrollTop: number }) {
  if (input.maxScrollTop <= 0) return 0
  return input.scrollTop / input.maxScrollTop
}

async function seedLongSession(client: ReturnType<typeof createLfcodeClient>, sessionID: string, turns = 24) {
  for (let index = 0; index < turns; index += 1) {
    const lines = Array.from(
      { length: 8 },
      (_, line) => `Scroll restore seed turn ${index + 1}, line ${line + 1}: keep enough content to force a tall timeline.`,
    ).join("\n")
    await client.session.prompt({
      sessionID,
      directory: projectDirectory,
      agent: "build",
      noReply: true,
      parts: [
        {
          type: "text",
          text: lines,
        },
      ],
    })
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
  const root = await mkdtemp(join(tmpdir(), "lfcode-scroll-"))
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
