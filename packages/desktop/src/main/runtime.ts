import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, rmSync } from "node:fs"
import { execFile, spawn } from "node:child_process"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import type { Event } from "electron"
import { app, BrowserWindow, dialog, session, shell, webContents } from "electron"
import pkg from "electron-updater"
import contextMenu from "electron-context-menu"
import { drizzle } from "drizzle-orm/node-sqlite/driver"
import type { Server } from "virtual:lfcode-server"
import type {
  DetachedSidePanelEvent,
  DetachedSidePanelRecord,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  WslConfig,
} from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { getBootstrapState } from "./bootstrap"
import { UPDATER_ENABLED } from "./constants"
import {
  registerIpcHandlers,
  sendDeepLinks,
  sendDetachedSidePanelEvent,
  sendMenuCommand,
  sendSqliteMigrationProgress,
} from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { migrate } from "./migrate"
import { getDefaultServerUrl, getWslConfig, setDefaultServerUrl, setWslConfig, spawnLocalServer } from "./server"
import { BaiduPanUpdateError, BaiduPanUpdater } from "./updater-baidu"
import {
  createLoadingWindow,
  createDetachedSidePanelWindow,
  createMainWindow,
  emitBrowserGuestRegistered,
  emitBrowserGuestUnregistered,
  registerRendererProtocol,
  setBackgroundColor,
  setDockIcon,
  setRelaunchHandler,
} from "./windows"
import {
  acknowledgeBrowserSavePasswordPrompt,
  captureBrowserPassword,
  clearAllBrowserCookies,
  clearBrowserCookiesByDomain,
  deleteSavedBrowserLogin,
  getBrowserPasswordStorageState,
  listBrowserAutofillCandidates,
  listBrowserCookies,
  listSavedBrowserLogins,
  removeBrowserCookie,
  resolveBrowserAutofill,
  upsertSavedBrowserLogin,
} from "./browser-management"
import {
  browserPartition,
  clearBrowserCache,
  clearBrowserGuestSiteData,
  getBrowserCacheOverview,
  getBrowserGuestReferenceState,
  markBrowserGuestReady,
  openBrowserGuestDevTools,
  setActiveBrowserTab,
  trackBrowserGuest,
  untrackBrowserGuest,
} from "./browser-runtime"
import { registerBrowserAutomationBridge } from "./browser-automation"
import { createAutomationEventBuffer } from "./automation-events"
import { startAutomationServer } from "./automation-server"
import { removeAutomationDiscovery, writeAutomationDiscovery } from "../automation-discovery"

contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

const { autoUpdater } = pkg
const initEmitter = new EventEmitter()
const bootstrapState = getBootstrapState()
let initStep: InitStep = { phase: "server_waiting" }
let mainWindow: BrowserWindow | null = null
let server: Server.Listener | null = null
let recoveryPromptOpen = false
let shuttingDown = false
let updateReady = false
let updateState: UpdateReadyState | undefined
let updateCheck: Promise<UpdateCheckResult> | undefined
let appSessionCacheTimer: ReturnType<typeof setInterval> | undefined
let browserSessionCacheTimer: ReturnType<typeof setInterval> | undefined
const loadingComplete = defer<void>()
const pendingDeepLinks: string[] = []
const serverReady = defer<ServerReadyData>()
const logger = initLogging()
const detachedSidePanels = new Map<
  string,
  DetachedSidePanelRecord & {
    route: string
    window: BrowserWindow
  }
>()
const detachedDockTargets = new Map<
  number,
  {
    sessionKey: string
    rect: { x: number; y: number; width: number; height: number }
  }
>()
const APP_SESSION_CACHE_STARTUP_CLEAR_BYTES = 64 * 1024 * 1024
const APP_SESSION_CACHE_SOFT_LIMIT_BYTES = 256 * 1024 * 1024
const BROWSER_SESSION_CACHE_STARTUP_CLEAR_BYTES = 64 * 1024 * 1024
const BROWSER_SESSION_CACHE_SOFT_LIMIT_BYTES = 192 * 1024 * 1024
const APP_SESSION_CACHE_CHECK_MS = 5 * 60 * 1000
const DISK_CACHE_LIMIT_BYTES = 128 * 1024 * 1024
const MEDIA_CACHE_LIMIT_BYTES = 32 * 1024 * 1024
const LOADING_WINDOW_COMPLETE_TIMEOUT_MS = 4000
const CLOSED_PIPE_WARN_THROTTLE_MS = 60 * 1000
let lastClosedPipeWarningAt = 0
let suppressedClosedPipeWarnings = 0
const execFileAsync = promisify(execFile)
const automationArgs = parseAutomationArgs(process.argv)
const automationEvents = createAutomationEventBuffer(400)
let automationServer: Awaited<ReturnType<typeof startAutomationServer>> | undefined
let automationDiscoveryRemoved = false

logger.log("app starting", {
  bootstrap: bootstrapState,
  packaged: app.isPackaged,
  userData: app.getPath("userData"),
  version: app.getVersion(),
  automation: automationArgs,
})

if (!automationArgs.enabled) {
  automationDiscoveryRemoved = true
  void removeAutomationDiscovery().catch(() => undefined)
}

migrate()
registerBrowserAutomationBridge()
setupApp()

async function installCli() {
  if (process.platform !== "win32") throw new Error("CLI install is currently only supported on Windows")
  const helperPath = app.isPackaged
    ? join(process.resourcesPath, "cli", "install-cli.cjs")
    : join(app.getAppPath(), "resources", "cli", "install-cli.cjs")
  const binaryPath = app.isPackaged
    ? join(process.resourcesPath, "cli", "lfcode.exe")
    : join(app.getAppPath(), "../lfcode/dist/lfcode-windows-x64-baseline/bin/lfcode.exe")
  if (!existsSync(helperPath)) throw new Error(`CLI installer helper not found: ${helperPath}`)
  if (!existsSync(binaryPath)) throw new Error(`CLI binary not found: ${binaryPath}`)
  const result = await execFileAsync(process.execPath, [helperPath, "install", "--scope", "user", "--binary", binaryPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    windowsHide: true,
  })
  return `${result.stdout || ""}`.trim()
}

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  app.commandLine.appendSwitch("disk-cache-size", String(DISK_CACHE_LIMIT_BYTES))
  app.commandLine.appendSwitch("media-cache-size", String(MEDIA_CACHE_LIMIT_BYTES))
  setRelaunchHandler(relaunchApp)
  purgeTransientSessionCaches()

  if (process.env.LFCODE_DISABLE_SINGLE_INSTANCE_LOCK !== "1" && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("lfcode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    shuttingDown = true
    logger.log("app before quit", captureProcessSnapshot({ note: "before-quit" }))
    clearAppSessionCacheGuard()
    closeAutomationServer()
    killSidecar()
  })

  app.on("will-quit", () => {
    shuttingDown = true
    logger.log("app will quit", captureProcessSnapshot({ note: "will-quit" }))
    clearAppSessionCacheGuard()
    closeAutomationServer()
    killSidecar()
  })

  app.on("child-process-gone", (_event, details) => {
    automationEvents.push({
      scope: "main",
      type: "child-process-gone",
      data: details,
    })
    logger.error("child process gone", {
      details,
      snapshot: captureProcessSnapshot({
        note: "child-process-gone",
      }),
    })
    if (details.reason === "clean-exit") return
    void showAppRecoveryDialog(
      "Lfcode background process ended unexpectedly",
      [`Type: ${details.type}`, `Reason: ${details.reason}`, `Name: ${details.name ?? "<unknown>"}`].join("\n"),
      ["Ignore", "Relaunch", "Quit"],
    )
  })

  process.on("uncaughtException", (error) => {
    handleFatalAppError("uncaughtException", error)
  })

  process.on("unhandledRejection", (reason) => {
    handleFatalAppError("unhandledRejection", reason)
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      exitApp(0)
    })
  }

  void app.whenReady()
    .then(async () => {
      app.setAsDefaultProtocolClient("lfcode")
      registerRendererProtocol()
      setDockIcon()
      ensurePortableWindowsShortcuts()
      setupAutoUpdater()
      startAppSessionCacheGuard()
      await initialize()
      automationServer = await startAutomationServer({
        enabled: automationArgs.enabled,
        host: "127.0.0.1",
        port: automationArgs.port,
        token: automationArgs.token,
        logger,
        events: automationEvents,
      })
      if (automationServer) {
        automationDiscoveryRemoved = false
        await writeAutomationDiscovery({
          host: automationServer.host,
          pid: process.pid,
          port: automationServer.port,
          startedAt: Date.now(),
          token: automationServer.token,
          userData: app.getPath("userData"),
          version: app.getVersion(),
        })
      }
    })
    .catch((error) => {
      handleFatalAppError("whenReady", error)
    })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  automationEvents.push({
    scope: "main",
    type: "deep-link",
    data: { urls },
  })
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  automationEvents.push({
    scope: "main",
    type: "window.focus-main",
    windowID: mainWindow.id,
  })
  mainWindow.show()
  mainWindow.focus()
}

function broadcastBrowserGuestRegistered(input: {
  sourceWindowID: number
  tabID: string
  guestID: number
}) {
  const target = BrowserWindow.fromId(input.sourceWindowID)
  if (!target || target.isDestroyed()) return
  emitBrowserGuestRegistered(target, input)
}

function broadcastBrowserGuestUnregistered(input: {
  sourceWindowID: number
  tabID: string
  guestID?: number
}) {
  const target = BrowserWindow.fromId(input.sourceWindowID)
  if (!target || target.isDestroyed()) return
  emitBrowserGuestUnregistered(target, input)
}

function broadcastDetachedSidePanelSync(active?: { detachedWindowID: string; active: boolean }) {
  const records = Array.from(detachedSidePanels.values()).map<DetachedSidePanelRecord>((item) => ({
    detachedWindowID: item.detachedWindowID,
    sessionKey: item.sessionKey,
    tab: item.tab,
    kind: item.kind,
    sourceWindowID: item.sourceWindowID,
    title: item.title,
  }))
  const events: DetachedSidePanelEvent[] = [{ type: "sync", records }]
  if (active) {
    events.push({
      type: "dock-target",
      detachedWindowID: active.detachedWindowID,
      active: active.active,
    })
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    for (const event of events) sendDetachedSidePanelEvent(win, event)
  }
}

function sendDetachedRedock(detachedWindowID: string, placement?: { afterTab?: string; beforeTab?: string }) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    sendDetachedSidePanelEvent(win, {
      type: "redock",
      detachedWindowID,
      placement,
    })
  }
}

function sendDetachedPrepareRedock(detachedWindowID: string) {
  const current = detachedSidePanels.get(detachedWindowID)
  if (!current || current.window.isDestroyed()) return
  sendDetachedSidePanelEvent(current.window, {
    type: "prepare-redock",
    detachedWindowID,
  })
}

function dockTargetActive(input: {
  sessionKey: string
  bounds: Electron.Rectangle
  sourceWindowID: number
}) {
  const target = detachedDockTargets.get(input.sourceWindowID)
  if (!target) return false
  if (target.sessionKey !== input.sessionKey) return false
  const centerX = input.bounds.x + input.bounds.width / 2
  const topY = input.bounds.y
  return (
    centerX >= target.rect.x &&
    centerX <= target.rect.x + target.rect.width &&
    topY >= target.rect.y - 80 &&
    topY <= target.rect.y + target.rect.height + 80
  )
}

function updateDetachedDockState(detachedWindowID: string) {
  const item = detachedSidePanels.get(detachedWindowID)
  if (!item) return false
  const active = dockTargetActive({
    sessionKey: item.sessionKey,
    bounds: item.window.getBounds(),
    sourceWindowID: item.sourceWindowID,
  })
  sendDetachedSidePanelEvent(item.window, {
    type: "dock-target",
    detachedWindowID,
    active,
  })
  return active
}

function finishDetachedRedock(detachedWindowID: string, placement?: { afterTab?: string; beforeTab?: string }) {
  const current = detachedSidePanels.get(detachedWindowID)
  if (!current) return
  detachedSidePanels.delete(detachedWindowID)
  sendDetachedRedock(detachedWindowID, placement)
  broadcastDetachedSidePanelSync()
  if (!current.window.isDestroyed()) current.window.destroy()
}

function setInitStep(step: InitStep) {
  initStep = step
  automationEvents.push({
    scope: "main",
    type: "init-step",
    data: step,
  })
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

async function initialize() {
  const needsMigration = !sqliteFileExists()
  const sqliteDone = needsMigration ? defer<void>() : undefined
  let overlay: BrowserWindow | null = null

  const port = await getSidecarPort()
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  const loadingTask = (async () => {
    logger.log("sidecar connection started", { url })

    initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
      if (progress.type === "Done") sqliteDone?.resolve()
    })

    if (needsMigration) {
      const { Database, JsonMigration } = await import("virtual:lfcode-server")
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event: { current: number; total: number }) => {
          const percent = Math.round(event.current / event.total) * 100
          initEmitter.emit("sqlite", { type: "InProgress", value: percent })
        },
      })
      initEmitter.emit("sqlite", { type: "Done" })
      sqliteDone?.resolve()
    }

    if (needsMigration) {
      await sqliteDone?.promise
    }

    logger.log("spawning sidecar", { url })
    const { listener, health } = await spawnLocalServer(hostname, port, password)
    server = listener
    serverReady.resolve({
      url,
      username: "lfcode",
      password,
    })

    await Promise.race([
      health.wait,
      delay(30_000).then(() => {
        throw new Error("Sidecar health check timed out")
      }),
    ]).catch((error) => {
      logger.error("sidecar health check failed", error)
    })

    logger.log("loading task finished")
  })()

  if (needsMigration) {
    const show = await Promise.race([loadingTask.then(() => false), delay(1_000).then(() => true)])
    if (show) {
      overlay = createLoadingWindow()
      await delay(1_000)
    }
  }

  await loadingTask
  setInitStep({ phase: "done" })

  if (overlay) {
    await Promise.race([
      loadingComplete.promise,
      delay(LOADING_WINDOW_COMPLETE_TIMEOUT_MS).then(() => {
        logger.warn?.("loading window completion timed out, continuing to main window", {
          timeoutMs: LOADING_WINDOW_COMPLETE_TIMEOUT_MS,
        })
      }),
    ])
  }

  mainWindow = createMainWindow()
  automationEvents.push({
    scope: "main",
    type: "window.main-created",
    windowID: mainWindow.id,
    data: { url: safe(() => mainWindow?.webContents.getURL()) },
  })
  wireMenu()
  overlay?.close()
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => relaunchApp(),
  })
}

registerIpcHandlers({
  killSidecar: () => killSidecar(),
  installCli: () => installCli(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep)
    const listener = (step: InitStep) => sendStep(step)
    initEmitter.on("step", listener)
    try {
      logger.log("awaiting server ready")
      const res = await serverReady.promise
      logger.log("server ready", { url: res.url })
      return res
    } finally {
      initEmitter.off("step", listener)
    }
  },
  getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
  consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config: WslConfig) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => undefined,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => {
    logger.log("loading window complete signal received")
    loadingComplete.resolve()
  },
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
  automationEvent: async (payload) => {
    automationEvents.push({
      scope: "renderer",
      type: payload.type,
      windowID: payload.windowID,
      data: payload.data,
    })
  },
  createDetachedSidePanelWindow: async (input) => {
    if (detachedSidePanels.has(input.detachedWindowID)) return
    const win = createDetachedSidePanelWindow({
      detachedWindowID: input.detachedWindowID,
      route: input.route,
      title: input.title,
      kind: input.kind,
    })
    detachedSidePanels.set(input.detachedWindowID, {
      detachedWindowID: input.detachedWindowID,
      sessionKey: input.sessionKey,
      tab: input.tab,
      kind: input.kind,
      sourceWindowID: input.sourceWindowID,
      title: input.title,
      route: input.route,
      window: win,
    })
    automationEvents.push({
      scope: "main",
      type: "sidepanel.detached.create",
      windowID: win.id,
      data: {
        detachedWindowID: input.detachedWindowID,
        sessionKey: input.sessionKey,
        tab: input.tab,
        kind: input.kind,
      },
    })
    let moveTimer: ReturnType<typeof setTimeout> | undefined
    win.on("move", () => {
      const active = updateDetachedDockState(input.detachedWindowID)
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        if (!active) return
        sendDetachedPrepareRedock(input.detachedWindowID)
      }, 120)
    })
    win.on("close", (event) => {
      if (!detachedSidePanels.has(input.detachedWindowID)) return
      event.preventDefault()
      finishDetachedRedock(input.detachedWindowID)
    })
    win.on("closed", () => {
      clearTimeout(moveTimer)
      if (!detachedSidePanels.has(input.detachedWindowID)) return
      detachedSidePanels.delete(input.detachedWindowID)
      broadcastDetachedSidePanelSync()
    })
    broadcastDetachedSidePanelSync()
  },
  redockDetachedSidePanelWindow: async (detachedWindowID) => {
    const current = detachedSidePanels.get(detachedWindowID)
    if (!current) return
    automationEvents.push({
      scope: "main",
      type: "sidepanel.detached.redock",
      windowID: current.window.id,
      data: { detachedWindowID },
    })
    finishDetachedRedock(detachedWindowID)
  },
  setDetachedDockTarget: async (senderWindowID, input) => {
    detachedDockTargets.set(senderWindowID, input)
    for (const [detachedWindowID, item] of detachedSidePanels) {
      if (item.sessionKey !== input.sessionKey) {
        sendDetachedSidePanelEvent(item.window, {
          type: "dock-target",
          detachedWindowID,
          active: false,
        })
        continue
      }
      updateDetachedDockState(detachedWindowID)
    }
  },
  clearDetachedDockTarget: async (senderWindowID) => {
    detachedDockTargets.delete(senderWindowID)
    for (const [detachedWindowID, item] of detachedSidePanels) {
      sendDetachedSidePanelEvent(item.window, {
        type: "dock-target",
        detachedWindowID,
        active: false,
      })
    }
  },
  registerBrowserGuest: async (target) => {
    automationEvents.push({
      scope: "main",
      type: "browser.guest.register",
      windowID: target.sourceWindowID,
      data: target,
    })
    trackBrowserGuest(target)
  },
  markBrowserGuestReady: async (target) => {
    automationEvents.push({
      scope: "main",
      type: "browser.guest.ready",
      windowID: target.sourceWindowID,
      data: target,
    })
    markBrowserGuestReady(target)
  },
  unregisterBrowserGuest: async (target) => {
    automationEvents.push({
      scope: "main",
      type: "browser.guest.unregister",
      windowID: target.sourceWindowID,
      data: target,
    })
    untrackBrowserGuest(target)
  },
  openBrowserDevTools: async (target) => {
    openBrowserGuestDevTools(target)
  },
  clearBrowserSiteData: async (target) => {
    return clearBrowserGuestSiteData(target)
  },
  getBrowserReferenceState: async (target) => {
    return getBrowserGuestReferenceState(target)
  },
  getBrowserCacheOverview: async () => {
    return getBrowserCacheOverview()
  },
  clearBrowserCache: async () => {
    return clearBrowserCache()
  },
  listBrowserCookies: async () => {
    return listBrowserCookies()
  },
  removeBrowserCookie: async (cookie) => {
    await removeBrowserCookie(cookie)
  },
  clearBrowserCookiesByDomain: async (domain) => {
    return clearBrowserCookiesByDomain(domain)
  },
  clearAllBrowserCookies: async () => {
    return clearAllBrowserCookies()
  },
  getBrowserPasswordStorageState: () => {
    return getBrowserPasswordStorageState()
  },
  listSavedBrowserLogins: async () => {
    return listSavedBrowserLogins()
  },
  upsertSavedBrowserLogin: async (input) => {
    return upsertSavedBrowserLogin(input)
  },
  deleteSavedBrowserLogin: async (id) => {
    await deleteSavedBrowserLogin(id)
  },
  acknowledgeBrowserSavePasswordPrompt: async (input) => {
    return acknowledgeBrowserSavePasswordPrompt(input)
  },
  listBrowserAutofillCandidates: async (origin) => {
    return listBrowserAutofillCandidates(origin)
  },
  resolveBrowserAutofill: async (input) => {
    return resolveBrowserAutofill(input)
  },
  captureBrowserPassword: async (input) => {
    captureBrowserPassword(input)
  },
  setActiveBrowserTab: async (target) => {
    automationEvents.push({
      scope: "main",
      type: "browser.tab.active",
      windowID: target.sourceWindowID,
      data: target,
    })
    setActiveBrowserTab({
      sourceWindowID: target.sourceWindowID,
      tabID: target.tabID,
      active: target.active,
      sessionKey: target.sessionKey,
      sessionID: target.sessionID,
    })
  },
})

function killSidecar() {
  if (!server) return
  server.stop()
  server = null
}

function clearAppSessionCacheGuard() {
  if (appSessionCacheTimer) {
    clearInterval(appSessionCacheTimer)
    appSessionCacheTimer = undefined
  }
  if (!browserSessionCacheTimer) return
  clearInterval(browserSessionCacheTimer)
  browserSessionCacheTimer = undefined
}

function startAppSessionCacheGuard() {
  if (!appSessionCacheTimer) {
    const trimDefault = (reason: "startup" | "interval") =>
      trimSessionCache({
        label: "default renderer",
        current: session.defaultSession,
        reason,
        startupLimit: APP_SESSION_CACHE_STARTUP_CLEAR_BYTES,
        intervalLimit: APP_SESSION_CACHE_SOFT_LIMIT_BYTES,
      })
    void trimDefault("startup")
    appSessionCacheTimer = setInterval(() => {
      void trimDefault("interval")
    }, APP_SESSION_CACHE_CHECK_MS)
  }
  if (browserSessionCacheTimer) return
  const browser = session.fromPartition(browserPartition())
  const trimBrowser = (reason: "startup" | "interval") =>
    trimSessionCache({
      label: "side browser",
      current: browser,
      reason,
      startupLimit: BROWSER_SESSION_CACHE_STARTUP_CLEAR_BYTES,
      intervalLimit: BROWSER_SESSION_CACHE_SOFT_LIMIT_BYTES,
    })
  void trimBrowser("startup")
  browserSessionCacheTimer = setInterval(() => {
    void trimBrowser("interval")
  }, APP_SESSION_CACHE_CHECK_MS)
}

function relaunchApp() {
  if (shuttingDown) return
  shuttingDown = true
  logger.log("app relaunch requested", captureProcessSnapshot({ note: "relaunch" }))
  closeAutomationServer()
  killSidecar()
  app.relaunch()
  app.exit(0)
}

function exitApp(code: number) {
  if (shuttingDown) return
  shuttingDown = true
  logger.log("app exit requested", {
    code,
    snapshot: captureProcessSnapshot({ note: "exit" }),
  })
  closeAutomationServer()
  killSidecar()
  app.exit(code)
}

function closeAutomationServer() {
  if (automationServer) {
    automationServer.close()
    automationServer = undefined
  }
  if (automationDiscoveryRemoved) return
  automationDiscoveryRemoved = true
  void removeAutomationDiscovery().catch((error) => {
    logger.warn?.("failed to remove automation discovery file", { error: formatError(error) })
  })
}

function handleFatalAppError(source: string, error: unknown) {
  automationEvents.push({
    scope: "main",
    type: "fatal-error",
    data: { source, error: formatError(error) },
  })
  if (isClosedPipeWriteError(error)) {
    const now = Date.now()
    if (now - lastClosedPipeWarningAt >= CLOSED_PIPE_WARN_THROTTLE_MS) {
      logger.warn("ignored closed pipe write error", {
        source,
        error: formatError(error),
        suppressed: suppressedClosedPipeWarnings,
      })
      lastClosedPipeWarningAt = now
      suppressedClosedPipeWarnings = 0
      return
    }
    suppressedClosedPipeWarnings += 1
    return
  }
  logger.error("fatal main process error", { source, error: formatError(error) })
  if (shuttingDown || recoveryPromptOpen) return
  if (isHeadlessWindowMode() || !app.isReady()) {
    exitApp(1)
    return
  }

  void showAppRecoveryDialog(
    "Lfcode encountered a fatal desktop error",
    [`Source: ${source}`, formatError(error)].join("\n\n"),
    ["Relaunch", "Quit"],
  )
}

async function showAppRecoveryDialog(message: string, detail: string, buttons: string[]) {
  if (recoveryPromptOpen || shuttingDown || isHeadlessWindowMode() || !app.isReady()) return
  recoveryPromptOpen = true
  const options = {
    type: "error" as const,
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  }
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const result = await (target ? dialog.showMessageBox(target, options) : dialog.showMessageBox(options))
    .catch((error) => {
      logger.error("failed to show app recovery dialog", { error: formatError(error) })
      return undefined
    })
    .finally(() => {
      recoveryPromptOpen = false
    })
  if (!result) return
  const action = buttons[result.response]
  if (action === "Relaunch") {
    relaunchApp()
    return
  }
  if (action === "Quit") exitApp(1)
}

function isHeadlessWindowMode() {
  return process.env.LFCODE_DESKTOP_HEADLESS === "1"
}

function formatError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === "string") return error
  return String(error)
}

function isClosedPipeWriteError(error: unknown) {
  const message = formatError(error)
  if (message.includes("write EOF")) return true
  if (message.includes("EPIPE")) return true
  if (message.includes("ERR_STREAM_DESTROYED")) return true
  return false
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function captureProcessSnapshot(input: { note: string }) {
  const appMetrics = app.getAppMetrics()
  const browser = BrowserWindow.getAllWindows().map((win) => {
    const contents = win.webContents
    return {
      id: win.id,
      title: safe(() => win.getTitle()),
      destroyed: win.isDestroyed(),
      focused: safe(() => win.isFocused()),
      visible: safe(() => win.isVisible()),
      minimized: safe(() => win.isMinimized()),
      bounds: safe(() => win.getBounds()),
      url: safe(() => currentWindowUrl(win)),
      webContentsId: contents.id,
      osPid: safe(() => contents.getOSProcessId()),
    }
  })
  const contents = webContents.getAllWebContents().map((item) => ({
    id: item.id,
    type: item.getType(),
    url: safe(() => item.getURL()),
    title: safe(() => item.getTitle()),
    loading: safe(() => item.isLoading()),
    destroyed: item.isDestroyed(),
    osPid: safe(() => item.getOSProcessId()),
  }))
  return {
    note: input.note,
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
    browser,
    contents,
  }
}

function summarizeAppMetrics(metrics: Electron.ProcessMetric[]) {
  const totalWorkingSetSize = metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0)
  const totalPrivateBytes = metrics.reduce((sum, item) => sum + (item.memory.privateBytes ?? 0), 0)
  return {
    processCount: metrics.length,
    totalWorkingSetMb: toMb(totalWorkingSetSize),
    totalPrivateMb: toMb(totalPrivateBytes),
    topWorkingSet: [...metrics]
      .sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
      .slice(0, 5)
      .map((item) => ({
        pid: item.pid,
        type: item.type,
        serviceName: item.serviceName,
        workingSetMb: toMb(item.memory.workingSetSize),
        privateMb: toMb(item.memory.privateBytes ?? 0),
        cpuPercent: Math.round(item.cpu.percentCPUUsage * 10) / 10,
      })),
  }
}

function summarizeNodeMemory(memory: NodeJS.MemoryUsage) {
  return {
    rssMb: toMbBytes(memory.rss),
    heapTotalMb: toMbBytes(memory.heapTotal),
    heapUsedMb: toMbBytes(memory.heapUsed),
    externalMb: toMbBytes(memory.external),
    arrayBuffersMb: toMbBytes(memory.arrayBuffers),
  }
}

function toMb(value: number) {
  return Math.round(value / 1024)
}

function toMbBytes(value: number) {
  return Math.round(value / 1024 / 1024)
}

function safe<T>(fn: () => T) {
  try {
    return fn()
  } catch (error) {
    return formatError(error)
  }
}

function currentWindowUrl(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return "<destroyed>"
  return win.webContents.getURL()
}

async function getSidecarPort() {
  const fromEnv = process.env.LFCODE_PORT
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function sqliteFileExists() {
  const dataDir = process.env.LFCODE_DATA_DIR
  if (dataDir) return existsSync(join(dataDir, "lfcode.db"))
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "lfcode", "lfcode.db"))
}

function trimSessionCache(input: {
  label: string
  current: Electron.Session
  reason: "startup" | "interval"
  startupLimit: number
  intervalLimit: number
}) {
  return input.current.getCacheSize()
    .catch(() => 0)
    .then(async (size) => {
      const limit = input.reason === "startup" ? input.startupLimit : input.intervalLimit
      if (size <= limit) return
      logger.log("clearing session cache", {
        session: input.label,
        reason: input.reason,
        size_mb: Math.round(size / 1024 / 1024),
      })
      await input.current.clearCache().catch((error) => {
        logger.warn("failed to clear session http cache", {
          session: input.label,
          reason: input.reason,
          error: formatError(error),
        })
      })
      await input.current.clearCodeCaches({ urls: [] }).catch((error) => {
        logger.warn("failed to clear session code cache", {
          session: input.label,
          reason: input.reason,
          error: formatError(error),
        })
      })
    })
}

function purgeTransientSessionCaches() {
  const userData = app.getPath("userData")
  const targets = [
    join(userData, "Cache"),
    join(userData, "Code Cache"),
    join(userData, "GPUCache"),
    join(userData, "DawnGraphiteCache"),
    join(userData, "DawnWebGPUCache"),
    join(userData, "Partitions", "lfcode-browser", "Cache"),
    join(userData, "Partitions", "lfcode-browser", "Code Cache"),
    join(userData, "Partitions", "lfcode-browser", "GPUCache"),
    join(userData, "Partitions", "lfcode-browser", "DawnGraphiteCache"),
    join(userData, "Partitions", "lfcode-browser", "DawnWebGPUCache"),
  ]
  let removed = 0
  for (const target of targets) {
    if (!existsSync(target)) continue
    try {
      rmSync(target, { force: true, recursive: true, maxRetries: 2 })
      removed += 1
    } catch (error) {
      logger.warn("failed to purge transient session cache", {
        target,
        error: formatError(error),
      })
    }
  }
  if (removed === 0) return
  logger.log("purged transient electron caches before ready", {
    removed,
    userData,
  })
}

function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  logger.log("auto updater configured", {
    allowDowngrade: autoUpdater.allowDowngrade,
    allowPrerelease: autoUpdater.allowPrerelease,
    channel: autoUpdater.channel,
    currentVersion: app.getVersion(),
  })
}

function ensurePortableWindowsShortcuts() {
  if (process.platform !== "win32" || !app.isPackaged || bootstrapState?.rootKind !== "portable") return

  const shortcut = {
    target: process.execPath,
    cwd: dirname(process.execPath),
    appUserModelId: bootstrapState.appId,
    description: `${bootstrapState.appName} portable launcher`,
    icon: process.execPath,
    iconIndex: 0,
  }
  const paths = [
    join(dirname(process.execPath), `${bootstrapState.appName}.lnk`),
    join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${bootstrapState.appName}.lnk`),
  ]

  for (const path of paths) {
    const ok = shell.writeShortcutLink(path, existsSync(path) ? "replace" : "create", shortcut)
    if (ok) logger.log("portable shortcut ensured", { path, target: shortcut.target })
    else logger.error("portable shortcut ensure failed", { path, target: shortcut.target })
  }
}

async function checkUpdate(): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (updateCheck) return updateCheck
  updateReady = false
  updateState = undefined
  updateCheck = (async () => {
    const github = await checkGithubUpdate()
    if (github.failed) {
      const baidu = await checkBaiduPanUpdate()
      if (baidu.updateAvailable) {
        logger.log("github failed, baidu fallback succeeded", { version: baidu.version })
        updateCheck = undefined
        return baidu
      }
      updateCheck = undefined
      return baidu.failed ? { updateAvailable: false, failed: true } : { updateAvailable: false }
    }
    updateCheck = undefined
    return github
  })()
  return updateCheck
}

async function installUpdate() {
  if (!updateReady) return
  if (updateState?.source === "github") {
    killSidecar()
    autoUpdater.quitAndInstall()
    return
  }
  if (updateState?.source === "baidu") {
    killSidecar()
    const child = spawn("cmd.exe", ["/c", "start", "", updateState.installerPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    app.exit(0)
  }
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if ("failed" in result && result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }
  const success = result as Extract<UpdateCheckResult, { updateAvailable: true }>
  const version = success.version

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${version} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    restartNow: response.response === 0,
    version,
  })
  if (response.response === 0) {
    await installUpdate()
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type UpdateReadyState =
  | { source: "github"; version: string }
  | { source: "baidu"; version: string; installerPath: string }

type UpdateCheckResult =
  | { updateAvailable: false; failed?: boolean }
  | { updateAvailable: true; version: string; source: UpdateReadyState["source"] }

async function checkGithubUpdate() {
  logger.log("checking for github updates", {
    allowDowngrade: autoUpdater.allowDowngrade,
    allowPrerelease: autoUpdater.allowPrerelease,
    channel: autoUpdater.channel,
    currentVersion: app.getVersion(),
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("github update metadata fetched", {
      files: updateInfo?.files?.map((file) => file.url) ?? [],
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      releaseVersion: updateInfo?.version ?? null,
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "github provider returned no newer version",
      })
      return { updateAvailable: false } satisfies UpdateCheckResult
    }
    logger.log("github update available", { version })
    await autoUpdater.downloadUpdate()
    logger.log("github update download completed", { version })
    updateReady = true
    updateState = { source: "github", version }
    return { updateAvailable: true, version, source: "github" as const } satisfies UpdateCheckResult
  } catch (error) {
    logger.error("github update check failed", error)
    return { updateAvailable: false, failed: true } satisfies UpdateCheckResult
  }
}

async function checkBaiduPanUpdate() {
  try {
    const updater = new BaiduPanUpdater({
      cacheDir: process.env.LFCODE_CACHE_DIR ?? join(app.getPath("temp"), "lfcode-cache"),
      currentVersion: app.getVersion(),
    })
    const result = await updater.downloadLatestIfAvailable()
    if (!result) return { updateAvailable: false } satisfies UpdateCheckResult
    updateReady = true
    updateState = { source: "baidu", version: result.version, installerPath: result.installerPath }
    return { updateAvailable: true, version: result.version, source: "baidu" as const } satisfies UpdateCheckResult
  } catch (error) {
    if (error instanceof BaiduPanUpdateError) {
      logger.warn?.("baidu fallback check failed", { message: error.message })
    } else {
      logger.error("baidu fallback check failed", error)
    }
    return { updateAvailable: false, failed: true } satisfies UpdateCheckResult
  }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function parseAutomationArgs(argv: string[]) {
  const disabled = argv.includes("--no-automation") || process.env.LFCODE_AUTOMATION === "0"
  const rawPort = argv
    .find((item) => item.startsWith("--automation-port="))
    ?.slice("--automation-port=".length) ?? process.env.LFCODE_AUTOMATION_PORT
  const token = argv
    .find((item) => item.startsWith("--automation-token="))
    ?.slice("--automation-token=".length) ?? process.env.LFCODE_AUTOMATION_TOKEN
  const port = rawPort ? Number(rawPort) : undefined
  return {
    enabled: !disabled,
    port: typeof port === "number" && Number.isFinite(port) && port > 0 ? port : undefined,
    token: token || undefined,
  }
}
