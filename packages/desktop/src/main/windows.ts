import { existsSync } from "node:fs"
import windowState from "electron-window-state"
import log from "electron-log/main.js"
import { app, BrowserWindow, dialog, net, nativeImage, nativeTheme, protocol, shell } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { getBootstrapState } from "./bootstrap"
import type { TitlebarTheme } from "../preload/types"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "oc"
const rendererHost = "renderer"

let rendererSchemeRegistered = false

export function registerRendererScheme() {
  if (rendererSchemeRegistered) return
  protocol.registerSchemesAsPrivileged([
    {
      scheme: rendererProtocol,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
  ])
  rendererSchemeRegistered = true
}

let backgroundColor: string | undefined
let relaunchHandler = () => {
  app.relaunch()
  app.exit(0)
}

function isHeadlessWindowMode() {
  return process.env.LFCODE_DESKTOP_HEADLESS === "1"
}

export function setRelaunchHandler(handler: () => void) {
  relaunchHandler = handler
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  BrowserWindow.getAllWindows().forEach((win) => win.setBackgroundColor(color))
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  const path = join(iconsDir(), `icon.${ext}`)
  return existsSync(path) ? path : undefined
}

function taskbarIconPath() {
  return iconPath() ?? (app.isPackaged && process.platform === "win32" ? process.execPath : undefined)
}

function applyWindowsTaskbarDetails(win: BrowserWindow) {
  if (process.platform !== "win32" || !app.isPackaged) return
  const bootstrap = getBootstrapState()
  if (!bootstrap) return
  const icon = taskbarIconPath()
  win.setAppDetails({
    appId: bootstrap.appId,
    ...(icon
      ? {
          appIconPath: icon,
          appIconIndex: 0,
        }
      : {}),
    relaunchCommand: `"${process.execPath}"`,
    relaunchDisplayName: bootstrap.appName,
  })
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: 40,
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(theme))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow() {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const headless = isHeadlessWindowMode()
  const mode = tone()
  const icon = iconPath()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    title: "Lfcode",
    ...(icon ? { icon } : {}),
    backgroundColor,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  })

  applyWindowsTaskbarDetails(win)
  wireWindowRecovery(win, "main")
  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    webPreferences.preload = undefined
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    params.partition = "persist:lfcode-browser"
    if (typeof params.src === "string" && !isAllowedEmbeddedURL(params.src)) {
      params.src = "about:blank"
    }
  })
  win.webContents.on("did-attach-webview", (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      win.webContents.send("browser-window-open", url)
      return { action: "deny" }
    })
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send("browser-window-open", url)
    return { action: "deny" }
  })
  win.webContents.session.on("will-download", (_event, item) => {
    void shell.openPath(item.getSavePath()).catch(() => undefined)
  })
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Origin", ["*"])
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Headers", ["*"])
    callback({ responseHeaders })
  })

  state.manage(win)
  loadWindow(win, "index.html", "main")
  wireZoom(win)

  if (!headless) {
    win.once("ready-to-show", () => {
      win.show()
    })
  }

  return win
}

function isAllowedEmbeddedURL(input: string) {
  try {
    const url = new URL(input)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:"
  } catch {
    return false
  }
}

export function createLoadingWindow() {
  const headless = isHeadlessWindowMode()
  const mode = tone()
  const icon = iconPath()
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: !headless,
    ...(icon ? { icon } : {}),
    backgroundColor,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  wireWindowRecovery(win, "loading")
  loadWindow(win, "loading.html", "loading")

  return win
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Not found", { status: 404 })
    }

    return net.fetch(pathToFileURL(file).toString())
  })
}

function loadWindow(win: BrowserWindow, html: string, name: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    const value = url.toString()
    void win.loadURL(value).catch((error) => {
      log.scope("window").error("window load rejected", { window: name, url: value, error })
    })
    return
  }

  const value = `${rendererProtocol}://${rendererHost}/${html}`
  void win.loadURL(value).catch((error) => {
    log.scope("window").error("window load rejected", { window: name, url: value, error })
  })
}

function wireWindowRecovery(win: BrowserWindow, name: string) {
  let dialogOpen = false

  const show = async (message: string, detail: string, buttons: string[]) => {
    if (dialogOpen || isHeadlessWindowMode() || win.isDestroyed()) return
    dialogOpen = true
    const result = await dialog
      .showMessageBox(win, {
        type: "warning",
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        message,
        detail,
        noLink: true,
      })
      .catch((error) => {
        log.scope("window").error("failed to show recovery dialog", { window: name, error })
        return undefined
      })
      .finally(() => {
        dialogOpen = false
      })
    if (!result) return
    const action = buttons[result.response]
    if (action === "Reload") {
      if (!win.isDestroyed()) win.reload()
      return
    }
    if (action === "Relaunch") {
      relaunchHandler()
      return
    }
    if (action === "Quit") app.quit()
  }

  const handleLoadFailure = (
    event: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    log.scope("window").error("renderer load failed", {
      window: name,
      event,
      errorCode,
      errorDescription,
      validatedURL,
      currentURL: currentUrl(win),
      isMainFrame,
    })

    if (!isMainFrame || errorCode === -3) return
    void show(
      "Lfcode failed to load",
      [`Window: ${name}`, `URL: ${validatedURL}`, `Error: ${errorCode} ${errorDescription}`].join("\n"),
      ["Reload", "Relaunch", "Quit"],
    )
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    handleLoadFailure("did-fail-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })

  win.webContents.on("did-fail-provisional-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    handleLoadFailure("did-fail-provisional-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })

  win.webContents.on("render-process-gone", (_event, details) => {
    log.scope("window").error("renderer process gone", {
      window: name,
      currentURL: currentUrl(win),
      details,
    })
    void show(
      "Lfcode window terminated unexpectedly",
      [`Window: ${name}`, `Reason: ${details.reason}`, `Code: ${details.exitCode ?? "<unknown>"}`].join("\n"),
      ["Relaunch", "Quit"],
    )
  })

  win.on("unresponsive", () => {
    log.scope("window").error("renderer unresponsive", { window: name, currentURL: currentUrl(win) })
    void show(
      "Lfcode is not responding",
      [`Window: ${name}`, `URL: ${currentUrl(win)}`].join("\n"),
      ["Keep Waiting", "Relaunch", "Quit"],
    )
  })

  win.on("responsive", () => {
    log.scope("window").info("renderer responsive", { window: name, currentURL: currentUrl(win) })
  })

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.scope("preload").error("preload error", { window: name, preloadPath, error })
    void show(
      "Lfcode preload failed",
      [`Window: ${name}`, `Preload: ${preloadPath}`, formatError(error)].join("\n"),
      ["Relaunch", "Quit"],
    )
  })
}

function currentUrl(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return "<destroyed>"
  return win.webContents.getURL()
}

function formatError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === "string") return error
  return String(error)
}

function wireZoom(win: BrowserWindow) {
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1)
  })
}

function upsertKeyValue(obj: Record<string, any>, keyToChange: string, value: any) {
  const keyToChangeLower = keyToChange.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value
      // Done
      return
    }
  }
  // Insert at end instead
  obj[keyToChange] = value
}
