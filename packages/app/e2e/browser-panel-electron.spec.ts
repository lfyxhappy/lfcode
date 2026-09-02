import { execFile } from "node:child_process"
import { createServer } from "node:http"
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
const projectPattern = new RegExp(escapeRegExp(projectDirectory))
const execFileAsync = promisify(execFile)

test.describe.configure({ timeout: 240_000 })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  await ensureDesktopBuild()
})

type DesktopSandbox = {
  root: string
  profileDir: string
  roamingAppData: string
  localAppData: string
  lfcodeHome: string
  appData: string
}

test("desktop browser handoff opens file:// content in a browser tab", async () => {
  const appData = await createAppData()
  const tempFile = await createTempFile()
  const expectedTempFileURL = normalizeURLForAssertion(tempFile)
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_USER_DATA_DIR: appData,
    },
  })

  try {
    const page = await openProjectSession(app)

    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send("browser-window-open", url)
    }, tempFile)

    await expect(page.locator("webview")).toHaveAttribute("src", new RegExp(escapeRegExp(expectedTempFileURL)), {
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
  const expectedTempFileURL = normalizeURLForAssertion(tempFile)
  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_USER_DATA_DIR: appData,
    },
  })

  try {
    const page = await openProjectSession(app)

    await page.getByRole("button", { name: /Open browser|打开浏览器/i }).click()
    const address = page.locator('#review-panel input[name="url"]')
    await expect(address).toHaveValue("https://www.bing.com", { timeout: 30_000 })
    await expect(page.locator('webview[src^="https://www.bing.com"]')).toHaveCount(1, {
      timeout: 30_000,
    })
    await address.fill(tempFile)
    await address.press("Enter")

    await expect(page.locator("webview")).toHaveAttribute("src", new RegExp(escapeRegExp(expectedTempFileURL)), {
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
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_USER_DATA_DIR: appData,
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

test("desktop session-scoped browser open request reuses the current review panel without opening a second page", async () => {
  const appData = await createAppData()
  const app = await launchDesktop(appData)

  try {
    const page = await openProjectSession(app)
    page.on("console", (message) => {
      console.log("SESSION_SCOPED_CONSOLE", message.type(), message.text())
    })
    page.on("pageerror", (error) => {
      console.log("SESSION_SCOPED_PAGE_ERROR", error.message)
    })
    const client = await createDesktopClient(app)
    const created = await client.session.create({
      directory: projectDirectory,
      title: "Browser Single Open",
    })
    const sessionID = created.data.id
    const route = `/${base64Encode(projectDirectory)}/session/${sessionID}`
    const sessionKey = `${base64Encode(projectDirectory.replaceAll("\\", "/"))}/${sessionID}`
    await page.setViewportSize({ width: 1440, height: 960 })
    await expect
      .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
      .toBe(true)
    await page.evaluate((next) => {
      window.__LFCODE__?.navigate?.(next)
    }, route)
    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${route}`)

    const target = "https://example.com/one-open-check"
    const requestID = "req_single_open_check"
    const requestHandled = await page.evaluate(
      ({ url, requestID, sessionID, directory }) => {
        const event = new CustomEvent("lfcode:browser-request-open", {
          detail: {
            url,
            requestID,
            sessionID,
            sessionKey: directory,
            reason: "tool",
          },
          cancelable: true,
        })
        window.dispatchEvent(event)
        return event.defaultPrevented
      },
      { url: target, requestID, sessionID, directory: sessionKey },
    )

    expect(requestHandled).toBe(true)
    console.log(
      "SESSION_SCOPED_BROWSER_SNAPSHOT",
      JSON.stringify({
        browser: await readBrowserPanelSnapshot(page),
        keys: await page.evaluate(() => Object.keys(window.__LFCODE__ ?? {})),
        session: await page.evaluate(() => (window.__LFCODE__ as Record<string, unknown> | undefined)?.debugSessionMessages ?? null),
      }),
    )
    await expect.poll(() => countVisibleBrowserInputs(page), { timeout: 30_000 }).toBe(1)
    await expect.poll(() => readBrowserTabLabels(page), { timeout: 30_000 }).toEqual([expect.stringMatching(/example\.com/i)])
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser selection does not expose legacy reference actions", async () => {
  const appData = await createAppData()
  const tempFile = await createTempFile(
    "Web Reference Test",
    '<main><p id="summary">This domain is for web reference testing.</p><button id="cta">Launch action</button></main>',
    "browser-reference.html",
  )
  const app = await launchDesktop(appData)

  try {
    const page = await openProjectSession(app)
    const expectedTempFileURL = normalizeURLForAssertion(tempFile)
    await clearPromptInput(page)
    await expect.poll(() => readPromptWebReferenceLabels(page), { timeout: 30_000 }).toEqual([])

    await emitBrowserOpen(app, tempFile)
    await expect.poll(() => readNormalizedActiveBrowserInput(page), { timeout: 30_000 }).toBe(expectedTempFileURL)
    await expect.poll(() => readGuestValue(app, tempFile, "document.title"), { timeout: 30_000 }).toBe("Web Reference Test")

    await expect.poll(() => selectGuestText(app, tempFile, "#summary"), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => clickGuestElement(app, tempFile, "#cta"), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => readBrowserReferenceState(page), { timeout: 30_000 }).toEqual({})
    await expect.poll(() => browserReferenceActionVisible(page, "selection"), { timeout: 30_000 }).toBe(false)
    await expect.poll(() => browserReferenceActionVisible(page, "element"), { timeout: 30_000 }).toBe(false)
    await expect.poll(() => readPromptWebReferenceLabels(page), { timeout: 30_000 }).toEqual([])
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser address bar falls back to the real page url after abandoning a draft", async () => {
  const appData = await createAppData()
  const tempFile = await createTempFile()
  const expectedTempFileURL = normalizeURLForAssertion(tempFile)
  const app = await launchDesktop(appData)

  try {
    const page = await openProjectSession(app)

    await emitBrowserOpen(app, tempFile)
    await expect.poll(() => readNormalizedActiveBrowserInput(page), { timeout: 30_000 }).toBe(expectedTempFileURL)

    await setActiveBrowserInputDraft(page, "https://wrong.example.invalid")

    await expect.poll(() => readNormalizedActiveBrowserInput(page), { timeout: 30_000 }).toBe(expectedTempFileURL)
  } finally {
    await closeApp(app)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser address bar follows the real page url after history replacement", async () => {
  const appData = await createAppData()
  const navigationServer = await createNavigationServer()
  const app = await launchDesktop(appData)

  try {
    const page = await openProjectSession(app)

    await emitBrowserOpen(app, navigationServer.startURL)
    await expect.poll(() => readActiveGuestURL(app), { timeout: 30_000 }).toBe(navigationServer.finalURL)
    await expect.poll(() => readActiveBrowserInput(page), { timeout: 30_000 }).toBe(navigationServer.finalURL)
  } finally {
    await closeApp(app)
    await navigationServer.close()
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
    await expect.poll(() => readDesktopBrowserAutomationTarget(firstRun), { timeout: 30_000 }).toMatchObject({
      url: secondFile,
    })
  } finally {
    await closeApp(firstRun)
  }

  const secondRun = await launchDesktop(appData)
  try {
    const page = await openProjectSession(secondRun)

    await expect(page.getByRole("tab", { name: /Restore One|restore-one\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("tab", { name: /Restore Two|restore-two\.html/ })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readActiveBrowserPath(page), { timeout: 30_000 }).toBe(normalizeFilePath(secondFile))
    await expect.poll(() => readDesktopBrowserAutomationTarget(secondRun), { timeout: 30_000 }).toMatchObject({
      url: secondFile,
    })
  } finally {
    await closeApp(secondRun)
    await rm(appData, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(firstFile), { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(secondFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser tab keeps live dom state across session switches", async () => {
  test.setTimeout(120_000)
  const sandbox = await createDesktopSandbox()
  const tempFile = await createTempFile(
    "Keepalive Session Switch",
    [
      '<button id="inc" type="button">inc</button>',
      "<script>",
      "document.getElementById('inc').addEventListener('click', () => {",
      "  document.title = 'keepalive-1'",
      "})",
      "</script>",
    ].join(""),
    "browser-keepalive.html",
  )
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    page.on("console", (message) => {
      console.log("KEEPALIVE_PAGE_CONSOLE", message.type(), message.text())
    })
    page.on("pageerror", (error) => {
      console.log("KEEPALIVE_PAGE_ERROR", error.message)
    })
    console.log("KEEPALIVE_STAGE", "user-data-dir", await app.evaluate(({ app }) => app.getPath("userData")))
    const client = await createDesktopClient(app)
    const primary = await client.session.create({
      directory: projectDirectory,
      title: "Browser Keepalive Session A",
    })
    const alternate = await client.session.create({
      directory: projectDirectory,
      title: "Browser Keepalive Session B",
    })
    const sessionRoute = `/${base64Encode(projectDirectory)}/session/${primary.data.id}`
    await expect
      .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
      .toBe(true)
    await page.evaluate((route) => {
      window.__LFCODE__?.navigate?.(route)
    }, sessionRoute)
    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${sessionRoute}`)
    console.log(
      "KEEPALIVE_STAGE",
      "window-keys-after-route",
      JSON.stringify(
        await page.evaluate(() =>
          window.__LFCODE__
            ? {
                keys: Object.keys(window.__LFCODE__),
                hasNavigate: typeof window.__LFCODE__.navigate === "function",
                debugSessionMessages: !!window.__LFCODE__.debugSessionMessages,
                debugScrollRestore: !!window.__LFCODE__.debugScrollRestore,
                debugBrowserPanels: !!window.__LFCODE__.debugBrowserPanels,
                debugBrowserKeepaliveHost: !!(window.__LFCODE__ as Record<string, unknown>).debugBrowserKeepaliveHost,
              }
            : null,
        ),
      ),
    )
    console.log("KEEPALIVE_STAGE", "opened-project-session", primary.data.id)
    console.log("KEEPALIVE_STAGE", "created-alternate-session", alternate.data.id)
    const alternateRoute = `/${base64Encode(projectDirectory)}/session/${alternate.data.id}`

    await expect.poll(() => emitBrowserOpen(app, tempFile), { timeout: 30_000 }).toBe(true)
    console.log("KEEPALIVE_STAGE", "opened-browser-tab")
    console.log("KEEPALIVE_STAGE", "post-open-snapshot", JSON.stringify(await readBrowserPanelSnapshot(page)))
    await expect.poll(() => readNormalizedActiveBrowserInput(page), { timeout: 30_000 }).toBe(
      normalizeURLForAssertion(tempFile),
    )
    console.log("KEEPALIVE_STAGE", "browser-input-ready")
    await expect.poll(() => readDesktopBrowserAutomationTarget(app), { timeout: 30_000 }).toMatchObject({
      url: normalizeURLForAssertion(tempFile),
    })
    const initialTarget = await readDesktopBrowserAutomationTarget(app)
    console.log("KEEPALIVE_STAGE", "initial-target", JSON.stringify(initialTarget))
    await expect.poll(() => readActiveBrowserTitle(app), {
      timeout: 30_000,
    }).toBe("Keepalive Session Switch")
    await expect.poll(() => setActiveGuestTitle(app, "keepalive-1"), {
      timeout: 30_000,
    }).toBe(true)
    await expect.poll(() => readActiveBrowserTitle(app), {
      timeout: 30_000,
    }).toBe("keepalive-1")
    console.log("KEEPALIVE_STAGE", "guest-title-updated")

    await page.evaluate((route) => {
      window.__LFCODE__?.navigate?.(route)
    }, alternateRoute)
    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${alternateRoute}`)
    console.log("KEEPALIVE_STAGE", "navigated-to-alternate")

    await page.evaluate((route) => {
      window.__LFCODE__?.navigate?.(route)
    }, sessionRoute)
    await expect
      .poll(async () => page.evaluate(() => window.__LFCODE__?.debugSessionMessages?.sessionID), { timeout: 30_000 })
      .toBe(sessionRoute.split("/").at(-1))
    console.log("KEEPALIVE_STAGE", "returned-to-original-session")
    await expect.poll(() => readNormalizedActiveBrowserInput(page), { timeout: 30_000 }).toBe(
      normalizeURLForAssertion(tempFile),
    )
    console.log("KEEPALIVE_STAGE", "browser-input-restored")
    const afterTarget = await readDesktopBrowserAutomationTarget(app)
    const guestSnapshot = await listBrowserGuestsForURL(app, tempFile)
    const runtimeDebug = await readDesktopBrowserRuntimeDebug(app)
    console.log("KEEPALIVE_STAGE", "after-target", JSON.stringify(afterTarget))
    console.log("KEEPALIVE_STAGE", "guest-snapshot", JSON.stringify(guestSnapshot))
    console.log("KEEPALIVE_STAGE", "runtime-debug", JSON.stringify(runtimeDebug))
    expect(afterTarget).toMatchObject({
      url: normalizeURLForAssertion(tempFile),
      title: "keepalive-1",
    })
    expect(afterTarget).not.toBeNull()
    expect(initialTarget).not.toBeNull()
    expect(afterTarget?.sourceWindowID).toBe(initialTarget?.sourceWindowID)
    expect(afterTarget?.tabID).toBe(initialTarget?.tabID)
    expect(Array.isArray(guestSnapshot)).toBe(true)
    expect(guestSnapshot).toHaveLength(1)
    await expect.poll(() => readActiveBrowserTitle(app), {
      timeout: 30_000,
    }).toBe("keepalive-1")
    console.log("KEEPALIVE_STAGE", "verified-keepalive")
  } finally {
    await closeApp(app)
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

test("desktop browser automation opens and owns a background session target without hijacking the foreground session", async () => {
  const sandbox = await createDesktopSandbox()
  const tempFile = await createTempFile("Background Session Browser", "background browser target", "background-browser.html")
  const expectedURL = normalizeURLForAssertion(tempFile)
  const app = await launchDesktop(sandbox)

  try {
    const page = await mainWindow(app)
    await page.setViewportSize({ width: 1440, height: 960 })
    const client = await createDesktopClient(app)
    const primary = await client.session.create({
      directory: projectDirectory,
      title: "Browser Isolation Session A",
    })
    const alternate = await client.session.create({
      directory: projectDirectory,
      title: "Browser Isolation Session B",
    })
    const primarySessionKey = `${base64Encode(projectDirectory)}/${primary.data.id}`
    const alternateRoute = `/${base64Encode(projectDirectory)}/session/${alternate.data.id}`

    await expect
      .poll(async () => page.evaluate(() => typeof window.__LFCODE__?.navigate === "function"), { timeout: 30_000 })
      .toBe(true)
    await page.evaluate((route) => {
      window.__LFCODE__?.navigate?.(route)
    }, alternateRoute)
    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${alternateRoute}`)

    await expect.poll(() => invokeDesktopBrowserNavigateForSession(app, primarySessionKey, primary.data.id, tempFile), {
      timeout: 30_000,
    }).toMatchObject({
      url: expectedURL,
      sessionKey: primarySessionKey,
      sessionID: primary.data.id,
    })

    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 }).toBe(`#${alternateRoute}`)
    await expect.poll(() => readDesktopBrowserAutomationTargetForSession(app, primarySessionKey), { timeout: 30_000 }).toMatchObject({
      url: expectedURL,
      sessionKey: primarySessionKey,
      sessionID: primary.data.id,
    })
    await expect.poll(() => readDesktopBrowserRuntimeDebug(app), { timeout: 30_000 }).toMatchObject({
      sessionActiveTargets: {
        [primarySessionKey]: expect.any(String),
      },
    })
    await expect(page.locator('webview[src^="file://"]')).toHaveCount(0)
  } finally {
    await closeApp(app)
    await rm(sandbox.root, { recursive: true, force: true }).catch(() => {})
    await rm(tempFileDir(tempFile), { recursive: true, force: true }).catch(() => {})
  }
})

async function launchDesktop(appData: string | DesktopSandbox) {
  const sandbox = typeof appData === "string" ? undefined : appData
  const userDataDir = typeof appData === "string" ? appData : appData.appData
  return electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      ...(sandbox
        ? {
            APPDATA: sandbox.roamingAppData,
            LOCALAPPDATA: sandbox.localAppData,
            USERPROFILE: sandbox.profileDir,
            LFCODE_HOME: sandbox.lfcodeHome,
          }
        : {}),
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_USER_DATA_DIR: userDataDir,
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
  const page = await mainWindow(app)
  return page.evaluate((target) => {
    const event = new CustomEvent("lfcode:browser-request-open", { detail: { url: target }, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, url)
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

async function readGuestValue(app: Awaited<ReturnType<typeof electron.launch>>, url: string, expression: string) {
  try {
    return await app.evaluate(async ({ webContents }, input) => {
      const normalize = (value: string) => {
        if (!value.startsWith("file:")) return value
        return value.replace(/^file:\/+/, "").replace(/\\/g, "/")
      }
      const guest = webContents
        .getAllWebContents()
        .find((contents) => {
          if (contents.getType() !== "webview") return false
          const current = contents.getURL()
          return current === input.url || normalize(current) === normalize(input.url)
        })
      if (!guest) return null
      return guest.executeJavaScript(input.expression)
    }, { url, expression })
  } catch {
    return null
  }
}

async function readDesktopBrowserAutomationTarget(app: Awaited<ReturnType<typeof electron.launch>>) {
  try {
    return await app.evaluate(() => {
      const runtime = (globalThis as Record<PropertyKey, { snapshot?: () => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-runtime-debug")
      ]
      const snapshot = runtime?.snapshot?.() as
        | {
            activeTabs?: Record<string, string>
            guests?: Array<{
              sourceWindowID?: number
              tabID?: string
              url?: string | null
              title?: string | null
              sessionKey?: string | null
              sessionID?: string | null
            }>
          }
        | undefined
      const guests = Array.isArray(snapshot?.guests) ? snapshot.guests : []
      for (const [sourceWindowID, tabID] of Object.entries(snapshot?.activeTabs ?? {})) {
        const match = guests.find((guest) => guest.sourceWindowID === Number(sourceWindowID) && guest.tabID === tabID)
        if (!match) continue
        return {
          sourceWindowID: match.sourceWindowID,
          tabID: match.tabID,
          url: match.url ?? "",
          title: match.title ?? "",
          sessionKey: match.sessionKey ?? undefined,
          sessionID: match.sessionID ?? undefined,
        }
      }
      const first = guests[0]
      if (first) {
        return {
          sourceWindowID: first.sourceWindowID,
          tabID: first.tabID,
          url: first.url ?? "",
          title: first.title ?? "",
          sessionKey: first.sessionKey ?? undefined,
          sessionID: first.sessionID ?? undefined,
        }
      }
      const bridge = (globalThis as Record<PropertyKey, { getTarget?: (input: { sessionKey: string }) => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-automation")
      ]
      return bridge?.getTarget?.({ sessionKey: "" }) ?? null
    })
  } catch {
    return null
  }
}

async function readDesktopBrowserAutomationTargetForSession(
  app: Awaited<ReturnType<typeof electron.launch>>,
  sessionKey: string,
) {
  try {
    return await app.evaluate((key) => {
      const bridge = (globalThis as Record<PropertyKey, { getTarget?: (input: { sessionKey: string }) => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-automation")
      ]
      return bridge?.getTarget?.({ sessionKey: key }) ?? null
    }, sessionKey)
  } catch {
    return null
  }
}

async function invokeDesktopBrowserNavigateForSession(
  app: Awaited<ReturnType<typeof electron.launch>>,
  sessionKey: string,
  sessionID: string,
  url: string,
) {
  return app.evaluate(async ({ url, sessionKey, sessionID: ownerSessionID }) => {
    const bridge = (globalThis as Record<
      PropertyKey,
      | {
          navigate?: (input: { sessionKey: string; sessionID?: string; url: string }) => Promise<unknown>
        }
      | undefined
    >)[Symbol.for("lfcode.desktop-browser-automation")]
    return bridge?.navigate?.({ sessionKey, sessionID: ownerSessionID, url }) ?? null
  }, { url, sessionKey, sessionID })
}

async function readDesktopBrowserRuntimeDebug(app: Awaited<ReturnType<typeof electron.launch>>) {
  try {
    return await app.evaluate(() => {
      const runtime = (globalThis as Record<PropertyKey, { snapshot?: () => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-runtime-debug")
      ]
      return runtime?.snapshot?.() ?? null
    })
  } catch {
    return null
  }
}

async function readActiveBrowserTitle(app: Awaited<ReturnType<typeof electron.launch>>) {
  try {
    const target = await readDesktopBrowserAutomationTarget(app)
    if (!target || typeof target !== "object" || !("title" in target)) return null
    const title = (target as { title?: unknown }).title
    return typeof title === "string" ? title : null
  } catch {
    return null
  }
}

async function setActiveGuestTitle(app: Awaited<ReturnType<typeof electron.launch>>, title: string) {
  try {
    return await app.evaluate(async ({ webContents }, nextTitle) => {
      const runtime = (globalThis as Record<PropertyKey, { snapshot?: () => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-runtime-debug")
      ]
      const snapshot = runtime?.snapshot?.() as
        | {
            activeTabs?: Record<string, string>
            guests?: Array<{
              sourceWindowID?: number
              tabID?: string
              url?: string | null
              title?: string | null
            }>
          }
        | undefined
      const guests = Array.isArray(snapshot?.guests) ? snapshot.guests : []
      const active = Object.entries(snapshot?.activeTabs ?? {})
        .map(([sourceWindowID, tabID]) =>
          guests.find((guest) => guest.sourceWindowID === Number(sourceWindowID) && guest.tabID === tabID),
        )
        .find((guest) => !!guest)
      if (!active?.url) return false
      const guest = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getType() === "webview" &&
            contents.getURL() === active.url &&
            contents.getTitle() === (active.title ?? ""),
        )
      if (!guest) return false
      await guest.executeJavaScript(`document.title = ${JSON.stringify(nextTitle)}`)
      return true
    }, title)
  } catch {
    return false
  }
}

async function listBrowserGuestsForURL(app: Awaited<ReturnType<typeof electron.launch>>, url: string) {
  try {
    return await app.evaluate(({ webContents }, targetURL) => {
      const normalize = (value: string) => {
        if (!value.startsWith("file:")) return value
        return value.replace(/^file:\/+/, "").replace(/\\/g, "/")
      }
      return webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === "webview")
        .flatMap((contents) => {
          const current = contents.getURL()
          if (current !== targetURL && normalize(current) !== normalize(targetURL)) return []
          return [
            {
              id: contents.id,
              url: current,
              title: contents.getTitle(),
            },
          ]
        })
    }, url)
  } catch {
    return null
  }
}

async function clickActiveBrowserElement(
  app: Awaited<ReturnType<typeof electron.launch>>,
  match: { tag?: string; text?: string; placeholder?: string },
) {
  return app.evaluate(async (criteria) => {
    const bridge = (globalThis as Record<PropertyKey, { snapshot?: () => Promise<{ elements?: Array<{ ref: string; text?: string; placeholder?: string; tag: string }> }>; click?: (input: { ref: string }) => Promise<unknown> } | undefined>)[
      Symbol.for("lfcode.desktop-browser-automation")
    ]
    const snapshot = await bridge?.snapshot?.()
    const target = snapshot?.elements?.find((element) => {
      if (criteria.tag && element.tag !== criteria.tag) return false
      if (criteria.text && element.text !== criteria.text) return false
      if (criteria.placeholder && element.placeholder !== criteria.placeholder) return false
      return true
    })
    if (!target) return false
    await bridge?.click?.({ ref: target.ref })
    return true
  }, match)
}

async function readActiveGuestURL(app: Awaited<ReturnType<typeof electron.launch>>) {
  try {
    return await app.evaluate(() => {
      const runtime = (globalThis as Record<PropertyKey, { snapshot?: () => unknown } | undefined>)[
        Symbol.for("lfcode.desktop-browser-runtime-debug")
      ]
      const snapshot = runtime?.snapshot?.() as
        | {
            activeTabs?: Record<string, string>
            guests?: Array<{
              sourceWindowID?: number
              tabID?: string
              url?: string | null
            }>
          }
        | undefined
      const guests = Array.isArray(snapshot?.guests) ? snapshot.guests : []
      const active = Object.entries(snapshot?.activeTabs ?? {})
        .map(([sourceWindowID, tabID]) =>
          guests.find((guest) => guest.sourceWindowID === Number(sourceWindowID) && guest.tabID === tabID),
        )
        .find((guest) => !!guest)
      return active?.url ?? null
    })
  } catch {
    return null
  }
}

async function selectGuestText(app: Awaited<ReturnType<typeof electron.launch>>, url: string, selector: string) {
  return readGuestValue(
    app,
    url,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof Element)) return false
      const selection = window.getSelection()
      if (!selection) return false
      const range = document.createRange()
      range.selectNodeContents(element)
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event("selectionchange"))
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return selection.toString().includes(element.textContent ?? "")
    })()`,
  )
}

async function clickGuestElement(app: Awaited<ReturnType<typeof electron.launch>>, url: string, selector: string) {
  return readGuestValue(
    app,
    url,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return false
      element.click()
      return true
    })()`,
  )
}

async function readGuestReferenceAttribute(app: Awaited<ReturnType<typeof electron.launch>>, url: string) {
  return readGuestValue(
    app,
    url,
    `(() => ({
      attr: document.documentElement.getAttribute("data-lfcode-browser-reference"),
      dataset: document.documentElement.dataset.lfcodeBrowserReference ?? null,
      selection: window.getSelection?.()?.toString?.() ?? "",
    }))()`,
  )
}

async function readActiveBrowserInput(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('input[name="url"]'))
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
      .filter((input) => {
        const style = window.getComputedStyle(input)
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return bRect.width * bRect.height - aRect.width * aRect.height
      })
    for (const input of candidates) {
      if (input.value) return input.value
    }
    return null
  })
}

async function browserReferenceActionVisible(
  page: Awaited<ReturnType<typeof mainWindow>>,
  kind: "selection" | "element",
) {
  return page.evaluate((targetKind) => {
    const tabs = Array.from(document.querySelectorAll('#review-panel [role="tab"][aria-selected="true"]'))
    for (const tab of tabs) {
      const panelID = tab.getAttribute("aria-controls")
      const panel = panelID ? document.getElementById(panelID) : null
      const action = panel?.querySelector(`[data-browser-reference-kind="${targetKind}"]`) as HTMLElement | null
      if (!action) continue
      const style = window.getComputedStyle(action)
      if (style.display !== "none" && style.visibility !== "hidden") return true
    }
    return false
  }, kind)
}

async function clickBrowserReferenceAction(
  page: Awaited<ReturnType<typeof mainWindow>>,
  kind: "selection" | "element",
) {
  await page.evaluate((targetKind) => {
    const tabs = Array.from(document.querySelectorAll('#review-panel [role="tab"][aria-selected="true"]'))
    for (const tab of tabs) {
      const panelID = tab.getAttribute("aria-controls")
      const panel = panelID ? document.getElementById(panelID) : null
      const button = panel?.querySelector(`[data-browser-reference-kind="${targetKind}"] button`)
      if (!(button instanceof HTMLButtonElement)) continue
      button.click()
      return
    }
    throw new Error(`No active browser reference button for ${targetKind}`)
  }, kind)
}

async function readNormalizedActiveBrowserInput(page: Awaited<ReturnType<typeof mainWindow>>) {
  const value = await readActiveBrowserInput(page)
  if (!value) return value
  return normalizeURLForAssertion(value)
}

async function readBrowserPanelSnapshot(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => ({
    hash: location.hash,
    tabs: Array.from(document.querySelectorAll('#review-panel [role="tab"]')).map((tab) => ({
      text: (tab.textContent ?? "").trim(),
      selected: tab.getAttribute("aria-selected"),
      controls: tab.getAttribute("aria-controls"),
    })),
    visibleInputs: Array.from(document.querySelectorAll('#review-panel input[name="url"]')).map((input) => ({
      value: input instanceof HTMLInputElement ? input.value : null,
      display: getComputedStyle(input).display,
      visibility: getComputedStyle(input).visibility,
      offsetParent: input instanceof HTMLElement ? !!input.offsetParent : null,
    })),
    browserPanels: (window.__LFCODE__ as Record<string, unknown> | undefined)?.debugBrowserPanels ?? null,
    browserKeepaliveHost: (window.__LFCODE__ as Record<string, unknown> | undefined)?.debugBrowserKeepaliveHost ?? null,
    browserKeepaliveHostEvents: (window.__LFCODE__ as Record<string, unknown> | undefined)?.debugBrowserKeepaliveHostEvents ?? null,
  }))
}

async function readPromptWebReferenceLabels(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[data-component="prompt-input"]')).filter((node) => {
      if (!(node instanceof HTMLElement)) return false
      const style = window.getComputedStyle(node)
      return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
    })
    const root = inputs.at(-1)
    if (!root) return []
    return Array.from(root.querySelectorAll('[data-type="web-reference"]')).map((node) => (node.textContent ?? "").trim())
  })
}

async function clearPromptInput(page: Awaited<ReturnType<typeof mainWindow>>) {
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[data-component="prompt-input"]')).filter((node) => {
      if (!(node instanceof HTMLElement)) return false
      const style = window.getComputedStyle(node)
      return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null
    })
    const root = inputs.at(-1)
    if (!(root instanceof HTMLElement)) throw new Error("No visible prompt input")
    root.replaceChildren()
    root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }))
  })
}

async function readBrowserReferenceState(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    type BrowserReferenceCandidate = {
      label?: string
      text?: string
      url?: string
      title?: string
      selector?: string
      mode?: "selection" | "element"
    }

    type BrowserReferenceState = {
      selection?: BrowserReferenceCandidate
      element?: BrowserReferenceCandidate
    }

    const root = Array.from(document.querySelectorAll('#review-panel [role="tab"][aria-selected="true"]'))
      .map((tab) => {
        const panelID = tab.getAttribute("aria-controls")
        const panel = panelID ? document.getElementById(panelID) : null
        return panel?.querySelector('[data-browser-reference-active="true"]') ?? null
      })
      .find((node): node is HTMLElement => node instanceof HTMLElement)
    if (!root) return {}

    const readCandidate = (kind: "selection" | "element") => {
      const prefix = `browserReference${kind[0].toUpperCase()}${kind.slice(1)}`
      const label = root.dataset[`${prefix}Label`]
      const text = root.dataset[`${prefix}Text`]
      const url = root.dataset[`${prefix}Url`]
      const title = root.dataset[`${prefix}Title`]
      const selector = root.dataset[`${prefix}Selector`]
      const mode = root.dataset[`${prefix}Mode`] as BrowserReferenceCandidate["mode"] | undefined
      if (!label && !text && !url && !selector && !mode) return
      return {
        label,
        text,
        url,
        title,
        selector,
        mode,
      } satisfies BrowserReferenceCandidate
    }

    return {
      selection: readCandidate("selection"),
      element: readCandidate("element"),
    } satisfies BrowserReferenceState
  })
}

async function readActiveBrowserPath(page: Awaited<ReturnType<typeof mainWindow>>) {
  const value = await readActiveBrowserInput(page)
  if (!value) return null
  return normalizeFilePath(value)
}

async function setActiveBrowserInputDraft(page: Awaited<ReturnType<typeof mainWindow>>, value: string) {
  await page.evaluate((next) => {
    const input = Array.from(document.querySelectorAll('#review-panel [role="tab"][aria-selected="true"]'))
      .map((tab) => {
        const panelID = tab.getAttribute("aria-controls")
        const panel = panelID ? document.getElementById(panelID) : null
        return panel?.querySelector('input[name="url"]') ?? null
      })
      .find((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    if (!input) throw new Error("No active browser address input")
    input.focus()
    input.value = ""
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.value = next
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.blur()
  }, value)
}

async function countVisibleBrowserInputs(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name="url"]')).filter((node) => {
      if (!(node instanceof HTMLInputElement)) return false
      const style = window.getComputedStyle(node)
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
    }).length,
  )
}

async function readBrowserTabLabels(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .filter((node) => {
        if (!(node instanceof HTMLElement)) return false
        const text = (node.textContent ?? "").trim()
        if (!text) return false
        const style = window.getComputedStyle(node)
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && /example\.com/i.test(text)
      })
      .map((node) => (node.textContent ?? "").trim()),
  )
}

async function createAppData() {
  const appData = await mkdtemp(join(tmpdir(), "lfcode-browser-"))
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

  await mkdir(appData, { recursive: true })
  await writeFile(
    join(appData, "lfcode.global.dat"),
    JSON.stringify({
      "globalSync.project": JSON.stringify({ value: [project] }),
    }),
  )

  return appData
}

async function createDesktopSandbox(): Promise<DesktopSandbox> {
  const root = await mkdtemp(join(tmpdir(), "lfcode-browser-"))
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

async function createTempFile(title = "Local Browser File", body = "local browser file", name = "browser-panel.html") {
  const file = join(await mkdtemp(join(tmpdir(), "lfcode-file-")), name)
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

async function createNavigationServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/replace-start") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      })
      response.end(`<!doctype html>
<title>Replace Start</title>
<body>replace start</body>
<script>
  setTimeout(() => {
    history.replaceState({}, "", "/replace-final")
    document.title = "Replace Final"
    document.body.textContent = "replace final"
  }, 50)
</script>`)
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
    throw new Error("Navigation server failed to bind a TCP port")
  }

  return {
    startURL: `http://127.0.0.1:${address.port}/replace-start`,
    finalURL: `http://127.0.0.1:${address.port}/replace-final`,
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

function normalizeURLForAssertion(url: string) {
  if (!url.startsWith("file:")) return url
  try {
    return new URL(url).href
  } catch {
    return url
  }
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
