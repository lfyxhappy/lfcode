import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
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

test("desktop session automation can drive the unified code editor and persist edits", async () => {
  test.setTimeout(120_000)
  await ensureDesktopBuild()
  const sandbox = await createDesktopSandbox()
  const editorFixture = await createEditorFixture()
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    await enableExperimentalCodeEditor(page)

    const client = await createDesktopClient(app)
    const created = await client.session.create({
      directory: projectDirectory,
      title: "Code Editor E2E",
    })
    const sessionID = created.data.id
    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`

    await navigateToRoute(page, route)
    await expect
      .poll(async () => (await readRendererSessionState(page))?.sessionID, { timeout: 30_000 })
      .toBe(sessionID)

    await callRendererAutomation(page, "filetab.focus", { path: editorFixture.filePath })
    await expect
      .poll(async () => (await readRendererSessionState(page))?.tabs?.active, { timeout: 30_000 })
      .toContain("automation-target.ts")

    await callRendererAutomation(page, "filetab.setMode", { mode: "edit" })
    const filePanel = page
      .locator('[data-automation-id="session-file-tab-panel"]')
      .filter({ has: page.locator('[data-automation-id="code-editor-phase0"]') })
      .first()
    await expect(filePanel.locator('[data-automation-id="code-editor-phase0"]')).toBeVisible({ timeout: 30_000 })
    await expect(filePanel.locator('[data-automation-id="code-editor-phase0-fallback"]')).toHaveCount(0)

    const updated = [
      "export const automationValue = 2",
      "export const automationLabel = \"edited-by-e2e\"",
      "",
    ].join("\n")

    await callRendererAutomation(page, "ui.type", {
      token: "filetab.active.editor",
      text: updated,
    })

    await expect
      .poll(
        async () =>
          callRendererAutomation(page, "ui.editor", {
            token: "filetab.active.editor",
            action: "getState",
          }),
        { timeout: 30_000 },
      )
      .toMatchObject({
        value: updated,
      })

    await callRendererAutomation(page, "filetab.save")
    await expect
      .poll(async () => (await readFile(editorFixture.filePath, "utf8")).replace(/\r\n/g, "\n"), { timeout: 30_000 })
      .toBe(updated)
  } finally {
    await closeApp(app)
    await rm(editorFixture.root, { recursive: true, force: true }).catch(() => {})
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop session automation can open another file tab with selection restore", async () => {
  test.setTimeout(120_000)
  await ensureDesktopBuild()
  const sandbox = await createDesktopSandbox()
  const editorFixture = await createNavigationFixture()
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    await enableExperimentalCodeEditor(page)

    const client = await createDesktopClient(app)
    const created = await client.session.create({
      directory: projectDirectory,
      title: "Code Editor Navigation E2E",
    })
    const sessionID = created.data.id
    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`

    await navigateToRoute(page, route)
    await expect
      .poll(async () => (await readRendererSessionState(page))?.sessionID, { timeout: 30_000 })
      .toBe(sessionID)

    await callRendererAutomation(page, "filetab.focus", { path: editorFixture.sourcePath })
    await expect
      .poll(async () => (await readRendererSessionState(page))?.tabs?.active, { timeout: 30_000 })
      .toContain("navigation-source.ts")

    await callRendererAutomation(page, "filetab.setMode", { mode: "edit" })
    await expect(
      page
        .locator('[data-automation-id="session-file-tab-panel"]')
        .filter({ has: page.locator('[data-automation-id="code-editor-phase0"]') })
        .first()
        .locator('[data-automation-id="code-editor-phase0"]'),
    ).toBeVisible({ timeout: 30_000 })

    await callRendererAutomation(page, "filetab.openPath", {
      path: editorFixture.targetPath,
      selection: {
        startLineNumber: 2,
        startColumn: 16,
        endLineNumber: 2,
        endColumn: 31,
      },
    })

    await expect
      .poll(async () => {
        const state = await readRendererSessionState(page)
        return {
          active: state?.tabs?.active ?? null,
          path: state?.fileTab?.path ?? null,
          selection: state?.fileTab?.editor?.selection ?? null,
        }
      }, { timeout: 30_000 })
      .toEqual({
        active: `file://${editorFixture.targetRelativePath}`,
        path: editorFixture.targetRelativePath,
        selection: {
          startLineNumber: 2,
          startColumn: 16,
          endLineNumber: 2,
          endColumn: 31,
        },
      })
  } finally {
    await closeApp(app)
    await rm(editorFixture.root, { recursive: true, force: true }).catch(() => {})
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

function readRendererSessionState(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(async () => {
    const state = await window.__LFCODE__?.automation?.getState?.()
    return (state as { session?: unknown } | undefined)?.session as any
  })
}

async function createEditorFixture() {
  const fixtureRoot = await mkdtemp(join(resolve(root, "packages", "app", "e2e"), "tmp-code-editor-"))
  const filePath = join(fixtureRoot, "automation-target.ts")
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(
    filePath,
    ['export const automationValue = 1', 'export const automationLabel = "seed"', ""].join("\n"),
    "utf8",
  )
  return {
    root: fixtureRoot,
    filePath: filePath.replaceAll("/", "\\"),
  }
}

async function createNavigationFixture() {
  const fixtureRoot = await mkdtemp(join(resolve(root, "packages", "app", "e2e"), "tmp-code-editor-nav-"))
  const sourcePath = join(fixtureRoot, "navigation-source.ts")
  const targetPath = join(fixtureRoot, "navigation-target.ts")
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(
    sourcePath,
    [
      'import { navigationValue } from "./navigation-target"',
      "",
      "export const consumeNavigationValue = () => navigationValue",
      "",
    ].join("\n"),
    "utf8",
  )
  await writeFile(
    targetPath,
    [
      'export const marker = "before"',
      "export const navigationValue = 42",
      'export const after = "done"',
      "",
    ].join("\n"),
    "utf8",
  )
  return {
    root: fixtureRoot,
    sourcePath: sourcePath.replaceAll("/", "\\"),
    targetPath: targetPath.replaceAll("/", "\\"),
    targetRelativePath: relative(projectDirectory, targetPath).replaceAll("\\", "/"),
  }
}

async function createDesktopSandbox(): Promise<DesktopSandbox> {
  const root = await mkdtemp(join(tmpdir(), "lfcode-code-editor-"))
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
