import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Event } from "electron"
import { app, BrowserWindow, dialog, shell } from "electron"
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
  registerRendererProtocol,
  setBackgroundColor,
  setDockIcon,
  setRelaunchHandler,
} from "./windows"

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

logger.log("app starting", {
  bootstrap: bootstrapState,
  packaged: app.isPackaged,
  userData: app.getPath("userData"),
  version: app.getVersion(),
})

migrate()
setupApp()

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  setRelaunchHandler(relaunchApp)

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
    killSidecar()
  })

  app.on("will-quit", () => {
    shuttingDown = true
    killSidecar()
  })

  app.on("child-process-gone", (_event, details) => {
    logger.error("child process gone", { details })
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
      await initialize()
    })
    .catch((error) => {
      handleFatalAppError("whenReady", error)
    })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
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
    await loadingComplete.promise
  }

  mainWindow = createMainWindow()
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
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
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
})

function killSidecar() {
  if (!server) return
  server.stop()
  server = null
}

function relaunchApp() {
  if (shuttingDown) return
  shuttingDown = true
  killSidecar()
  app.relaunch()
  app.exit(0)
}

function exitApp(code: number) {
  if (shuttingDown) return
  shuttingDown = true
  killSidecar()
  app.exit(code)
}

function handleFatalAppError(source: string, error: unknown) {
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
  if (dataDir) return existsSync(join(dataDir, "lfcode.db")) || existsSync(join(dataDir, "opencode.db"))
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "lfcode", "lfcode.db")) || existsSync(join(base, "lfcode", "opencode.db"))
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
