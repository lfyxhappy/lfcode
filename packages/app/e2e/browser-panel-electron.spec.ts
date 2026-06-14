import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { test, expect, _electron as electron } from "@playwright/test"

const root = "C:/算法/小应用/知识库/10_Projects/opencode"
const projectDirectory = "C:\\算法\\小应用\\知识库\\10_Projects\\opencode"
const projectPattern = new RegExp(escapeRegExp(projectDirectory))
const execFileAsync = promisify(execFile)

test("desktop browser handoff opens file:// content in a browser tab", async () => {
  const appData = await createAppData()
  const tempFile = await createTempFile()
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      OPENCODE_DESKTOP_HEADLESS: "1",
      OPENCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      OPENCODE_USER_DATA_DIR: appData,
    },
  })

  try {
    const page = await openProjectSession(app)

    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send("browser-window-open", url)
    }, tempFile)

    await expect(page.locator("webview")).toHaveAttribute("src", new RegExp(escapeRegExp(tempFile)), {
      timeout: 30_000,
    })
    await expect(page.getByRole("tab", { name: /browser-panel\.html/ })).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop session header opens a browser tab and loads a typed file url", async () => {
  const appData = await createAppData()
  const tempFile = await createTempFile()
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      OPENCODE_DESKTOP_HEADLESS: "1",
      OPENCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      OPENCODE_USER_DATA_DIR: appData,
    },
  })

  try {
    const page = await openProjectSession(app)

    await page.getByRole("button", { name: /Open browser|打开浏览器/i }).click()
    const address = page.locator('#review-panel input[name="url"]')
    await expect(address).toHaveValue("https://", { timeout: 30_000 })
    await address.fill(tempFile)
    await address.press("Enter")

    await expect(page.locator("webview")).toHaveAttribute("src", new RegExp(escapeRegExp(tempFile)), {
      timeout: 30_000,
    })
    await expect(page.getByRole("tab", { name: /browser-panel\.html/ })).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser handoff from popup opens a new right-side browser tab", async () => {
  const appData = await createAppData()
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      OPENCODE_DESKTOP_HEADLESS: "1",
      OPENCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      OPENCODE_USER_DATA_DIR: appData,
    },
  })

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    await expect(projectButton(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("#review-panel")).toHaveCount(0)

    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send("browser-window-open", url)
    }, "https://example.com")

    const browserTab = page.getByRole("tab", { name: /Example Domain|example\.com/i })
    await expect(browserTab).toBeVisible({ timeout: 60_000 })
    await browserTab.click()

    await expect(page.locator('webview[src^="https://example.com"]')).toHaveCount(1, {
      timeout: 60_000,
    })
    await expect(page.locator('webview[src^="https://example.com"]')).toHaveAttribute("src", /https:\/\/example\.com/, {
      timeout: 60_000,
    })
    await expect(page.locator("#review-panel")).toHaveCount(1, { timeout: 60_000 })

    await app.evaluate(({ BrowserWindow, webContents }, url) => {
      const win = BrowserWindow.getAllWindows()[0]
      const webview = webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL().includes("https://example.com"))
      void webview?.executeJavaScript(`window.open(${JSON.stringify(url)}, "_blank")`)
    }, "https://popup.example.com")

    const popupTab = page.getByRole("tab", { name: /popup\.example\.com/ })
    await expect(popupTab).toBeVisible({ timeout: 60_000 })
    await popupTab.click()

    await expect(page.locator('webview[src^="https://popup.example.com"]')).toHaveCount(1, {
      timeout: 60_000,
    })
    await expect(page.locator('webview[src^="https://popup.example.com"]')).toHaveAttribute("src", /https:\/\/popup\.example\.com/, {
      timeout: 60_000,
    })
    await expect(page.getByRole("tab", { name: /popup\.example\.com/ })).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => countVisibleBrowserInputs(page), { timeout: 10_000 }).toBe(1)
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop non-session external link opens inside the right-side browser", async () => {
  const appData = await createAppData()
  const app = await launchDesktop(appData)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })

    const helpButton = page.getByRole("button", { name: /帮助|Help/i }).first()
    await expect(helpButton).toBeVisible({ timeout: 30_000 })
    await helpButton.click()

    await expect(page.locator("#review-panel")).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByRole("tab", { name: /discord\.gg|desktop-feedback/i })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('webview[src*="discord.gg"], webview[src*="desktop-feedback"]')).toHaveCount(1, {
      timeout: 60_000,
    })
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser tabs share cookie state through the embedded partition", async () => {
  const appData = await createAppData()
  const cookieServer = await createCookieServer()
  const app = await launchDesktop(appData)

  try {
    const page = await openProjectSession(app)

    await emitBrowserOpen(app, cookieServer.setURL)
    await expect
      .poll(() => readGuestValue(app, cookieServer.setURL, "document.title"), { timeout: 30_000 })
      .toBe("Cookie Set")

    await emitBrowserOpen(app, cookieServer.readURL)
    await expect
      .poll(() => readGuestValue(app, cookieServer.readURL, "document.title"), { timeout: 30_000 })
      .toBe("Cookie Visible")
    await expect.poll(() => readActiveBrowserInput(page), { timeout: 30_000 }).toBe(cookieServer.readURL)
  } finally {
    await closeApp(app)
    await cookieServer.close()
    await rm(appData, { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser tabs restore after relaunch with the previous active tab", async () => {
  const appData = await createAppData()
  const firstFile = await createTempFile("Restore One", "restore one", "restore-one.html")
  const secondFile = await createTempFile("Restore Two", "restore two", "restore-two.html")

  const firstRun = await launchDesktop(appData)
  try {
    const page = await mainWindow(firstRun)
    await page.setViewportSize({ width: 1440, height: 960 })
    await expect(projectButton(page)).toBeVisible({ timeout: 30_000 })

    await emitBrowserOpen(firstRun, firstFile)
    await expect(page.locator("#review-panel")).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByRole("tab", { name: /Restore One|restore-one\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readActiveBrowserPath(page), { timeout: 30_000 }).toBe(normalizeFilePath(firstFile))

    await emitBrowserOpen(firstRun, secondFile)
    await expect(page.getByRole("tab", { name: /Restore Two|restore-two\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readActiveBrowserPath(page), { timeout: 30_000 }).toBe(normalizeFilePath(secondFile))
  } finally {
    await closeApp(firstRun)
  }

  const secondRun = await launchDesktop(appData)
  try {
    const page = await openProjectSession(secondRun)

    await expect(page.getByRole("tab", { name: /Restore One|restore-one\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("tab", { name: /Restore Two|restore-two\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readActiveBrowserPath(page), { timeout: 30_000 }).toBe(normalizeFilePath(secondFile))
  } finally {
    await closeApp(secondRun)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(firstFile), { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(secondFile), { recursive: true, force: true }).catch(() => {})
  }
})

async function launchDesktop(appData: string) {
  return electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      OPENCODE_DESKTOP_HEADLESS: "1",
      OPENCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      OPENCODE_USER_DATA_DIR: appData,
    },
  })
}

async function openProjectSession(app: Awaited<ReturnType<typeof electron.launch>>) {
  const page = await mainWindow(app)
  await page.setViewportSize({ width: 1440, height: 960 })
  const reviewPanel = page.locator("#review-panel")
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if ((await reviewPanel.count()) > 0) return page

    const visible = await projectButton(page)
      .isVisible()
      .then((value) => value)
      .catch(() => false)
    if (visible) {
      await projectButton(page).click()
      await expect(reviewPanel).toHaveCount(1, { timeout: 30_000 })
      return page
    }

    await page.waitForTimeout(250)
  }

  await expect(projectButton(page)).toBeVisible({ timeout: 30_000 })
  await projectButton(page).click()
  await expect(reviewPanel).toHaveCount(1, { timeout: 30_000 })
  return page
}

function projectButton(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.locator("button").filter({ hasText: projectDirectory }).first()
}

async function emitBrowserOpen(app: Awaited<ReturnType<typeof electron.launch>>, url: string) {
  await app.evaluate(({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send("browser-window-open", target)
  }, url)
}

async function readGuestValue(app: Awaited<ReturnType<typeof electron.launch>>, url: string, expression: string) {
  try {
    return await app.evaluate(async ({ webContents }, input) => {
      const guest = webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL() === input.url)
      if (!guest) return null
      return guest.executeJavaScript(input.expression)
    }, { url, expression })
  } catch {
    return null
  }
}

async function readActiveBrowserInput(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const tab = document.querySelector('#review-panel [role="tab"][aria-selected="true"]')
    const panelID = tab?.getAttribute("aria-controls")
    if (!panelID) return null
    const panel = document.getElementById(panelID)
    const input = panel?.querySelector('input[name="url"]')
    if (!(input instanceof HTMLInputElement)) return null
    return input.value
  })
}

async function readActiveBrowserPath(page: Awaited<ReturnType<typeof mainWindow>>) {
  const value = await readActiveBrowserInput(page)
  if (!value) return null
  return normalizeFilePath(value)
}

async function countVisibleBrowserInputs(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#review-panel input[name="url"]')).filter((node) => {
      if (!(node instanceof HTMLInputElement)) return false
      const style = window.getComputedStyle(node)
      return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
    }).length,
  )
}

async function createAppData() {
  const appData = await mkdtemp(join(tmpdir(), "opencode-browser-"))
  const project = {
    id: "project-opencode",
    worktree: projectDirectory,
    vcs: "git",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
    sandboxes: [],
  }

  await mkdir(appData, { recursive: true })
  await writeFile(
    join(appData, "opencode.global.dat"),
    JSON.stringify({
      "globalSync.project": JSON.stringify({ value: [project] }),
    }),
  )
  return appData
}

async function createTempFile(title = "Local Browser File", body = "local browser file", name = "browser-panel.html") {
  const file = join(await mkdtemp(join(tmpdir(), "opencode-file-")), name)
  await writeFile(file, `<!doctype html><title>${title}</title><body>${body}</body>`)
  return `file://${file.replace(/\\/g, "/")}`
}

async function createCookieServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/set") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "shared_login=1; Path=/",
      })
      response.end("<!doctype html><title>Cookie Set</title><body>cookie set</body>")
      return
    }

    if (url.pathname === "/read") {
      const cookie = request.headers.cookie ?? ""
      const title = cookie.includes("shared_login=1") ? "Cookie Visible" : "Cookie Missing"
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      })
      response.end(`<!doctype html><title>${title}</title><body>${cookie}</body>`)
      return
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("not found")
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Cookie server failed to bind a TCP port")
  }

  return {
    setURL: `http://127.0.0.1:${address.port}/set`,
    readURL: `http://127.0.0.1:${address.port}/read`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

async function mainWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  const first = await app.firstWindow()
  await first.waitForLoadState("domcontentloaded")
  const existing = app.windows().find((page) => page.url().includes("index.html"))
  if (existing) return existing
  const next = await app.waitForEvent("window")
  await next.waitForLoadState("domcontentloaded")
  return next
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tempFileDir(url: string) {
  const path = url.slice("file://".length)
  return path.slice(0, path.lastIndexOf("/"))
}

function normalizeFilePath(url: string) {
  return url.replace(/^file:\/+/, "").replace(/\\/g, "/")
}

async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>) {
  const child = app.process()
  try {
    await app.evaluate(({ app }) => app.quit())
  } catch {}
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
