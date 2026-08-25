import { existsSync } from "node:fs"
import windowState from "electron-window-state"
import log from "electron-log/main.js"
import { app, BrowserWindow, dialog, net, nativeImage, nativeTheme, protocol, session, shell, webContents } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { getBootstrapState } from "./bootstrap"
import type { DetachedSidePanelKind, TitlebarTheme } from "../preload/types"
import { browserPartition, clearBrowserWindow, getBrowserGuestOwner, recordBrowserNetwork } from "./browser-runtime"
import { wireBrowserGuest } from "./browser-management"
import { downloadNeedsOpenConfirmation, isManagedAutomationDownload } from "./download-security"
import { appRouteFromRendererNavigation } from "./renderer-route"

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
const wiredSessions = new WeakSet<Electron.Session>()

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

  const win = createAppWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    title: "Lfcode",
    webviewTag: true,
  })

  applyWindowsTaskbarDetails(win)
  wireWindowRecovery(win, "main")
  wireBrowserEvents(win)

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

export function createDetachedSidePanelWindow(input: {
  detachedWindowID: string
  route: string
  title?: string
  kind: DetachedSidePanelKind
  background?: boolean
}) {
  const win = createAppWindow({
    width: 980,
    height: 720,
    minWidth: 560,
    minHeight: 360,
    show: !input.background,
    skipTaskbar: input.background,
    title: input.title ?? "Lfcode",
    webviewTag: input.kind === "browser",
  })

  applyWindowsTaskbarDetails(win)
  wireBrowserEvents(win)
  wireZoom(win)
  loadWindow(win, "index.html", `detached-side-panel:${input.detachedWindowID}`, input.route)
  return win
}

export function emitBrowserGuestRegistered(win: BrowserWindow, input: {
  sourceWindowID: number
  tabID: string
  guestID: number
}) {
  win.webContents.send("browser-guest-registered", input)
}

export function emitBrowserGuestUnregistered(win: BrowserWindow, input: {
  sourceWindowID: number
  tabID: string
  guestID?: number
}) {
  win.webContents.send("browser-guest-unregistered", input)
}

function isAllowedEmbeddedURL(input: string) {
  try {
    const url = new URL(input)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:"
  } catch {
    return false
  }
}

function isExternalMainWindowNavigation(input: string) {
  if (!isAllowedEmbeddedURL(input)) return false
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    try {
      return new URL(input).origin !== new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return true
}

export function createLoadingWindow() {
  const win = createAppWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: !isHeadlessWindowMode(),
    title: "Lfcode",
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

function loadWindow(win: BrowserWindow, html: string, name: string, route?: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    if (route) url.hash = route
    const value = url.toString()
    void win.loadURL(value).catch((error) => {
      log.scope("window").error("window load rejected", { window: name, url: value, error })
    })
    return
  }

  const value = `${rendererProtocol}://${rendererHost}/${html}${route ? `#${route}` : ""}`
  void win.loadURL(value).catch((error) => {
    log.scope("window").error("window load rejected", { window: name, url: value, error })
  })
}

function createAppWindow(
  input: Electron.BrowserWindowConstructorOptions & {
    title: string
    webviewTag?: boolean
  },
) {
  const headless = isHeadlessWindowMode()
  const mode = tone()
  const icon = iconPath()
  const win = new BrowserWindow({
    ...input,
    show: input.show ?? !headless,
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
      backgroundThrottling: false,
      webviewTag: input.webviewTag ?? false,
    },
  })
  const emitVisibility = () => {
    if (win.isDestroyed()) return
    if (win.webContents.isDestroyed()) return
    win.webContents.send("window-visibility", win.isVisible() && !win.isMinimized())
  }
  win.on("show", emitVisibility)
  win.on("hide", emitVisibility)
  win.on("minimize", emitVisibility)
  win.on("restore", emitVisibility)
  win.webContents.once("did-finish-load", emitVisibility)
  return win
}

function wireBrowserEvents(win: BrowserWindow) {
  win.on("closed", () => {
    clearBrowserWindow(win.id)
  })
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    webPreferences.preload = join(root, "../preload/browser-webview.js")
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.backgroundThrottling = false
    params.partition = browserPartition()
    if (typeof params.src === "string" && !isAllowedEmbeddedURL(params.src)) {
      params.src = "about:blank"
    }
  })
  win.webContents.on("did-attach-webview", (_event, guest) => {
    log.scope("browser").info("webview attached", {
      window: win.id,
      guestID: guest.id,
      url: guest.getURL(),
    })
    guest.setBackgroundThrottling(false)
    wireBrowserGuest({
      sourceWindowID: win.id,
      guest,
    })
    guest.on("render-process-gone", (_guestEvent, details) => {
      log.scope("browser").error("webview renderer process gone", {
        window: win.id,
        guestID: guest.id,
        url: guest.getURL(),
        details,
        snapshot: processSnapshot(),
      })
    })
    guest.on("destroyed", () => {
      log.scope("browser").info("webview destroyed", {
        window: win.id,
        guestID: guest.id,
      })
    })
    guest.setWindowOpenHandler(({ url }) => {
      win.webContents.send("browser-window-open", {
        ...getBrowserGuestOwner(guest.id),
        url,
        reason: "human",
      })
      return { action: "deny" }
    })
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send("browser-window-open", { url, reason: "human" })
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    const route = appRouteFromRendererNavigation(url)
    if (route) {
      event.preventDefault()
      loadWindow(win, "index.html", "renderer-route-recovery", route)
      return
    }
    if (!isExternalMainWindowNavigation(url)) return
    event.preventDefault()
    win.webContents.send("browser-window-open", { url, reason: "human" })
  })
  wireSessionEvents(win.webContents.session)
  wireSessionEvents(session.fromPartition(browserPartition()))
}

function wireSessionEvents(current: Electron.Session) {
  if (wiredSessions.has(current)) return
  wiredSessions.add(current)

  current.on("will-download", (_event, item, contents) => {
    item.once("done", (_itemEvent, state) => {
      const sourceWindowID = getBrowserGuestOwner(contents.id)?.sourceWindowID
      const owner =
        BrowserWindow.fromWebContents(contents) ??
        (sourceWindowID ? BrowserWindow.fromId(sourceWindowID) : null) ??
        BrowserWindow.getFocusedWindow() ??
        undefined
      if (state !== "completed") {
        if (state === "cancelled") return
        void showDownloadDialog(owner, {
          type: "error",
          title: "Download failed",
          message: item.getFilename(),
          detail: `The download did not complete (${state}). The file was not opened.`,
          buttons: ["Close"],
        })
        return
      }
      const savePath = item.getSavePath()
      if (isManagedAutomationDownload(savePath, app.getPath("userData"))) return
      void promptForCompletedDownload(owner, savePath, item.getFilename())
    })
  })

  current.webRequest.onCompleted((details) => {
    if (typeof details.webContentsId !== "number") return
    recordBrowserNetwork({
      guestID: details.webContentsId,
      entry: {
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        statusCode: details.statusCode,
        fromCache: details.fromCache,
        mimeType: readHeaderValue(details.responseHeaders, "content-type"),
        contentDisposition: readHeaderValue(details.responseHeaders, "content-disposition"),
        time: Date.now(),
      },
    })
  })

  current.webRequest.onErrorOccurred((details) => {
    if (typeof details.webContentsId !== "number") return
    recordBrowserNetwork({
      guestID: details.webContentsId,
      entry: {
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        error: details.error,
        time: Date.now(),
      },
    })
  })
}

function processSnapshot() {
  const appMetrics = app.getAppMetrics()
  return {
    summary: summarizeAppMetrics(appMetrics),
    mainProcessMemory: summarizeNodeMemory(process.memoryUsage()),
    appMetrics: appMetrics.map((item) => ({
      pid: item.pid,
      type: item.type,
      serviceName: item.serviceName,
      creationTime: item.creationTime,
      memory: item.memory,
      cpu: item.cpu,
      sandboxed: item.sandboxed,
      integrityLevel: item.integrityLevel,
    })),
    contents: webContents.getAllWebContents().map((item) => ({
      id: item.id,
      type: item.getType(),
      url: safe(() => item.getURL()),
      title: safe(() => item.getTitle()),
      loading: safe(() => item.isLoading()),
      destroyed: item.isDestroyed(),
      osPid: safe(() => item.getOSProcessId()),
    })),
  }
}

function summarizeAppMetrics(metrics: Electron.ProcessMetric[]) {
  const totalWorkingSetSize = metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0)
  const totalPrivateBytes = metrics.reduce((sum, item) => sum + (item.memory.privateBytes ?? 0), 0)
  return {
    processCount: metrics.length,
    totalWorkingSetMb: Math.round(totalWorkingSetSize / 1024),
    totalPrivateMb: Math.round(totalPrivateBytes / 1024),
    topWorkingSet: [...metrics]
      .sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
      .slice(0, 5)
      .map((item) => ({
        pid: item.pid,
        type: item.type,
        serviceName: item.serviceName,
        workingSetMb: Math.round(item.memory.workingSetSize / 1024),
        privateMb: Math.round((item.memory.privateBytes ?? 0) / 1024),
        cpuPercent: Math.round(item.cpu.percentCPUUsage * 10) / 10,
      })),
  }
}

function summarizeNodeMemory(memory: NodeJS.MemoryUsage) {
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    arrayBuffersMb: Math.round(memory.arrayBuffers / 1024 / 1024),
  }
}

function safe<T>(fn: () => T) {
  try {
    return fn()
  } catch (error) {
    return formatError(error)
  }
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
      snapshot: processSnapshot(),
    })
    void show(
      "Lfcode window terminated unexpectedly",
      [`Window: ${name}`, `Reason: ${details.reason}`, `Code: ${details.exitCode ?? "<unknown>"}`].join("\n"),
      ["Relaunch", "Quit"],
    )
  })

  win.on("unresponsive", () => {
    log.scope("window").error("renderer unresponsive", {
      window: name,
      currentURL: currentUrl(win),
      snapshot: processSnapshot(),
    })
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

async function promptForCompletedDownload(owner: BrowserWindow | undefined, savePath: string, filename: string) {
  const risky = downloadNeedsOpenConfirmation(filename)
  const result = await showDownloadDialog(owner, {
    type: risky ? "warning" : "info",
    title: "Download completed",
    message: filename,
    detail: risky
      ? "This file type can run code or is not recognized. Review its source before opening it."
      : "The file was downloaded successfully. Choose whether to reveal or open it.",
    buttons: ["Show in folder", risky ? "Review and open" : "Open file", "Close"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (result.response === 0) {
    shell.showItemInFolder(savePath)
    return
  }
  if (result.response !== 1) return
  if (risky) {
    const confirmation = await showDownloadDialog(owner, {
      type: "warning",
      title: "Open potentially unsafe download?",
      message: filename,
      detail: "Only continue if you trust the download source. Lfcode has not verified this file.",
      buttons: ["Cancel", "Open anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) return
  }
  const error = await shell.openPath(savePath)
  if (!error) return
  await showDownloadDialog(owner, {
    type: "error",
    title: "Unable to open download",
    message: filename,
    detail: error,
    buttons: ["Close"],
  })
}

function showDownloadDialog(owner: BrowserWindow | undefined, options: Electron.MessageBoxOptions) {
  if (owner) return dialog.showMessageBox(owner, options)
  return dialog.showMessageBox(options)
}

function readHeaderValue(headers: Electron.OnHeadersReceivedListenerDetails["responseHeaders"], key: string) {
  if (!headers) return undefined
  const lower = key.toLowerCase()
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() !== lower) continue
    if (Array.isArray(value)) {
      const next = value.find((item): item is string => typeof item === "string" && item.trim().length > 0)
      return next?.trim()
    }
  }
  return undefined
}
