import { execFile } from "node:child_process"
import { lstat, readFile, readdir } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type {
  BrowserAutofillCandidate,
  BrowserAutofillRequest,
  BrowserCacheOverview,
  BrowserCookieIdentity,
  BrowserPasswordCapturePrompt,
  BrowserPasswordCapturePayload,
  BrowserPasswordPromptAck,
  BrowserPasswordStorageState,
  SavedBrowserLoginRecord,
  SavedBrowserLoginUpsert,
} from "@lfcode-ai/shared/desktop-browser-management"

import type {
  AutomationEventPayload,
  BrowserGuestTarget,
  BrowserSiteDataResult,
  BrowserStateSync,
  BrowserWindowOpenRequest,
  DetachedSidePanelEvent,
  DetachedSidePanelRecord,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WindowVisibility,
  WslConfig,
  MobileAccessStatus,
  LanAccessDevice,
  LanBrowserPairing,
} from "../preload/types"
import { openExternal } from "./external"
import { clipboardFilePaths } from "./clipboard-files"
import { clipboardImagePayload } from "./clipboard-image"
import { getStore } from "./store"
import { setTitlebar } from "./windows"
import { browserAutofillOriginMatches } from "./browser-management-core"

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

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

type Deps = {
  killSidecar: () => void
  installCli: () => Promise<string> | string
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  getMobileAccessStatus: () => Promise<MobileAccessStatus> | MobileAccessStatus
  enableMobileAccess: () => Promise<MobileAccessStatus> | MobileAccessStatus
  disableMobileAccess: () => Promise<MobileAccessStatus> | MobileAccessStatus
  applyMobileAccessNetworkChange: () => Promise<MobileAccessStatus> | MobileAccessStatus
  revokeMobileDevice: (deviceID: string) => Promise<void> | void
  listMobileDevices: () => Promise<LanAccessDevice[]> | LanAccessDevice[]
  createLanBrowserPairing: () => Promise<LanBrowserPairing> | LanBrowserPairing
  resetMobileAccessCertificate: () => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  getWindowVisibility: (windowID: number) => WindowVisibility
  automationEvent: (payload: AutomationEventPayload) => Promise<void> | void
  createDetachedSidePanelWindow: (input: {
    detachedWindowID: string
    route: string
    sessionKey: string
    tab: string
    kind: "file" | "browser" | "review"
    title?: string
    sourceWindowID: number
    background?: boolean
  }) => Promise<void> | void
  redockDetachedSidePanelWindow: (
    detachedWindowID: string,
    placement?: {
      afterTab?: string
      beforeTab?: string
    },
  ) => Promise<void> | void
  setDetachedDockTarget: (
    senderWindowID: number,
    input: {
      sessionKey: string
      rect: { x: number; y: number; width: number; height: number }
    },
  ) => Promise<void> | void
  clearDetachedDockTarget: (senderWindowID: number) => Promise<void> | void
  registerBrowserGuest: (target: BrowserGuestTarget & { guestID: number }) => Promise<void> | void
  markBrowserGuestReady: (target: BrowserGuestTarget & { guestID: number }) => Promise<void> | void
  unregisterBrowserGuest: (target: BrowserGuestTarget & { guestID?: number }) => Promise<void> | void
  openBrowserDevTools: (target: BrowserGuestTarget) => Promise<void> | void
  clearBrowserSiteData: (target: BrowserGuestTarget) => Promise<BrowserSiteDataResult> | BrowserSiteDataResult
  getBrowserReferenceState: (target: BrowserGuestTarget) => Promise<BrowserReferenceState | null> | BrowserReferenceState | null
  getBrowserCacheOverview: () => Promise<BrowserCacheOverview> | BrowserCacheOverview
  clearBrowserCache: () => Promise<BrowserCacheOverview> | BrowserCacheOverview
  listBrowserCookies: () => Promise<any[]> | any[]
  removeBrowserCookie: (cookie: BrowserCookieIdentity) => Promise<void> | void
  clearBrowserCookiesByDomain: (domain: string) => Promise<number> | number
  clearAllBrowserCookies: () => Promise<number> | number
  getBrowserPasswordStorageState: () => Promise<BrowserPasswordStorageState> | BrowserPasswordStorageState
  listSavedBrowserLogins: () => Promise<SavedBrowserLoginRecord[]> | SavedBrowserLoginRecord[]
  upsertSavedBrowserLogin: (input: SavedBrowserLoginUpsert) => Promise<SavedBrowserLoginRecord> | SavedBrowserLoginRecord
  deleteSavedBrowserLogin: (id: string) => Promise<void> | void
  acknowledgeBrowserSavePasswordPrompt: (input: BrowserPasswordPromptAck) => Promise<SavedBrowserLoginRecord | null> | SavedBrowserLoginRecord | null
  listBrowserAutofillCandidates: (origin: string) => Promise<BrowserAutofillCandidate[]> | BrowserAutofillCandidate[]
  resolveBrowserAutofill: (input: BrowserAutofillRequest) => Promise<{ username: string; password: string } | null> | { username: string; password: string } | null
  captureBrowserPassword: (input: { guestID: number; payload: BrowserPasswordCapturePayload }) => Promise<void> | void
  setActiveBrowserTab: (target: BrowserGuestTarget & { active: boolean }) => Promise<void> | void
  reportBrowserState: (senderWindowID: number, input: BrowserStateSync) => Promise<void> | void
}

const droppedImageMime = (path: string) => {
  const extension = extname(path).toLowerCase()
  if (extension === ".gif") return "image/gif"
  if (extension === ".jpeg" || extension === ".jpg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".webp") return "image/webp"
  if (extension === ".avif") return "image/avif"
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("install-cli", () => deps.installCli())
  ipcMain.handle("await-initialization", (event: IpcMainInvokeEvent) => {
    const send = (step: InitStep) => event.sender.send("init-step", step)
    return deps.awaitInitialization(send)
  })
  ipcMain.handle("get-window-config", () => deps.getWindowConfig())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig())
  ipcMain.handle("set-wsl-config", (_event: IpcMainInvokeEvent, config: WslConfig) => deps.setWslConfig(config))
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("get-mobile-access-status", () => deps.getMobileAccessStatus())
  ipcMain.handle("enable-mobile-access", () => deps.enableMobileAccess())
  ipcMain.handle("disable-mobile-access", () => deps.disableMobileAccess())
  ipcMain.handle("apply-mobile-access-network-change", () => deps.applyMobileAccessNetworkChange())
  ipcMain.handle("revoke-mobile-device", (_event: IpcMainInvokeEvent, deviceID: string) => deps.revokeMobileDevice(deviceID))
  ipcMain.handle("list-mobile-devices", () => deps.listMobileDevices())
  ipcMain.handle("create-lan-browser-pairing", () => deps.createLanBrowserPairing())
  ipcMain.handle("reset-mobile-access-certificate", () => deps.resetMobileAccessCertificate())
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("wsl-path", (_event: IpcMainInvokeEvent, path: string, mode: "windows" | "linux" | null) =>
    deps.wslPath(path, mode),
  )
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete())
  ipcMain.handle("run-updater", (_event: IpcMainInvokeEvent, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.on("automation-event", (_event: IpcMainEvent, payload: AutomationEventPayload) => deps.automationEvent(payload))
  ipcMain.handle(
    "create-detached-side-panel-window",
    (event: IpcMainInvokeEvent, input: Omit<DetachedSidePanelRecord, "sourceWindowID"> & { route: string; background?: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return deps.createDetachedSidePanelWindow({
        ...input,
        route: input.route,
        sourceWindowID: win?.id ?? -1,
      })
    },
  )
  ipcMain.handle(
    "redock-detached-side-panel-window",
    (_event: IpcMainInvokeEvent, detachedWindowID: string, placement?: { afterTab?: string; beforeTab?: string }) =>
      deps.redockDetachedSidePanelWindow(detachedWindowID, placement),
  )
  ipcMain.handle(
    "set-detached-dock-target",
    (event: IpcMainInvokeEvent, input: { sessionKey: string; rect: { x: number; y: number; width: number; height: number } }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return deps.setDetachedDockTarget(win?.id ?? -1, input)
    },
  )
  ipcMain.handle("clear-detached-dock-target", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return deps.clearDetachedDockTarget(win?.id ?? -1)
  })
  ipcMain.handle("register-browser-guest", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget & { guestID: number }) => {
    return deps.registerBrowserGuest(target)
  })
  ipcMain.handle("mark-browser-guest-ready", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget & { guestID: number }) => {
    return deps.markBrowserGuestReady(target)
  })
  ipcMain.handle("unregister-browser-guest", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget & { guestID?: number }) => {
    return deps.unregisterBrowserGuest(target)
  })
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    const store = getStore(name)
    const value = store.get(key)
    if (value === undefined || value === null) return null
    return typeof value === "string" ? value : JSON.stringify(value)
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      _event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; accept?: string[]; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-attachment-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Attach files or folders",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-link", (_event: IpcMainEvent, detail: BrowserWindowOpenRequest | string) => {
    const win = BrowserWindow.fromWebContents(_event.sender)
    const payload = typeof detail === "string" ? { url: detail } : detail
    if (!payload?.url) return
    win?.webContents.send("browser-window-open", payload)
  })

  ipcMain.handle("read-dropped-image", async (_event: IpcMainInvokeEvent, path: string) => {
    if (!isAbsolute(path)) return null
    const mime = droppedImageMime(path)
    if (!mime) return null
    const bytes = await readFile(path)
    if (bytes.byteLength > 20 * 1024 * 1024) return null
    return {
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      filename: basename(path),
      mime,
    }
  })

  ipcMain.handle("read-editor-snippets", async (_event: IpcMainInvokeEvent, directory: string) => {
    return readEditorSnippetFiles(directory)
  })

  ipcMain.handle("read-clipboard-file-paths", () => {
    const read = (format: string) => {
      try {
        return clipboard.readBuffer(format)
      } catch {
        return undefined
      }
    }
    return clipboardFilePaths({
      fileDrop: read("FileDrop"),
      fileNameWide: read("FileNameW"),
      fileName: read("FileName"),
    })
  })

  ipcMain.on("open-external-link", (_event: IpcMainEvent, url: string) => {
    void openExternal(url)
  })
  ipcMain.handle("open-browser-devtools", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget) => {
    return deps.openBrowserDevTools(target)
  })
  ipcMain.handle("clear-browser-site-data", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget) => {
    return deps.clearBrowserSiteData(target)
  })
  ipcMain.handle("get-browser-reference-state", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget) => {
    return deps.getBrowserReferenceState(target)
  })
  ipcMain.handle("get-browser-cache-overview", () => deps.getBrowserCacheOverview())
  ipcMain.handle("clear-browser-cache", () => deps.clearBrowserCache())
  ipcMain.handle("list-browser-cookies", () => deps.listBrowserCookies())
  ipcMain.handle("remove-browser-cookie", (_event: IpcMainInvokeEvent, cookie: BrowserCookieIdentity) => {
    return deps.removeBrowserCookie(cookie)
  })
  ipcMain.handle("clear-browser-cookies-by-domain", (_event: IpcMainInvokeEvent, domain: string) => {
    return deps.clearBrowserCookiesByDomain(domain)
  })
  ipcMain.handle("clear-all-browser-cookies", () => deps.clearAllBrowserCookies())
  ipcMain.handle("get-browser-password-storage-state", () => deps.getBrowserPasswordStorageState())
  ipcMain.handle("list-saved-browser-logins", () => deps.listSavedBrowserLogins())
  ipcMain.handle("upsert-saved-browser-login", (_event: IpcMainInvokeEvent, input: SavedBrowserLoginUpsert) => {
    return deps.upsertSavedBrowserLogin(input)
  })
  ipcMain.handle("delete-saved-browser-login", (_event: IpcMainInvokeEvent, id: string) => {
    return deps.deleteSavedBrowserLogin(id)
  })
  ipcMain.handle("acknowledge-browser-save-password-prompt", (_event: IpcMainInvokeEvent, input: BrowserPasswordPromptAck) => {
    return deps.acknowledgeBrowserSavePasswordPrompt(input)
  })
  ipcMain.handle("browser-list-autofill-candidates", (event: IpcMainInvokeEvent, origin: string) => {
    if (!browserAutofillOriginMatches(event.sender.getURL(), origin)) return []
    return deps.listBrowserAutofillCandidates(origin)
  })
  ipcMain.handle("browser-request-autofill", (event: IpcMainInvokeEvent, input: BrowserAutofillRequest) => {
    if (!browserAutofillOriginMatches(event.sender.getURL(), input.origin)) return null
    return deps.resolveBrowserAutofill(input)
  })
  ipcMain.on("browser-password-capture", (event: IpcMainEvent, payload: BrowserPasswordCapturePayload) => {
    if (!browserAutofillOriginMatches(event.sender.getURL(), payload.origin)) return
    return deps.captureBrowserPassword({
      guestID: event.sender.id,
      payload,
    })
  })
  ipcMain.handle("set-active-browser-tab", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget & { active: boolean }) => {
    return deps.setActiveBrowserTab(target)
  })
  ipcMain.handle("report-browser-state", (event: IpcMainInvokeEvent, input: BrowserStateSync) => {
    return deps.reportBrowserState(BrowserWindow.fromWebContents(event.sender)?.id ?? -1, input)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })
  ipcMain.handle("stat-path", async (_event: IpcMainInvokeEvent, path: string) => {
    if (!isAbsolute(path)) return { exists: false, kind: "unknown" as const }
    const info = await lstat(path).catch(() => undefined)
    if (!info) return { exists: false, kind: "unknown" as const }
    if (info.isDirectory()) return { exists: true, kind: "directory" as const }
    if (info.isFile()) return { exists: true, kind: "file" as const }
    return { exists: true, kind: "unknown" as const }
  })

  ipcMain.handle("read-clipboard-image", () => {
    return clipboardImagePayload(clipboard.readImage())
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)
  ipcMain.handle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.id ?? null
  })
  ipcMain.handle("get-window-visibility", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return deps.getWindowVisibility(win?.id ?? -1)
  })
  ipcMain.handle("get-renderer-memory-info", (event: IpcMainInvokeEvent) => {
    const metric = app.getAppMetrics().find((item) => item.pid === event.sender.getOSProcessId())
    return {
      private: metric?.memory.privateBytes ?? 0,
      shared: 0,
      residentSet: metric?.memory.workingSetSize ?? 0,
    }
  })

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => event.sender.setZoomFactor(factor))
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
}

export function sendSqliteMigrationProgress(win: BrowserWindow, progress: SqliteMigrationProgress) {
  win.webContents.send("sqlite-migration-progress", progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}


export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}

async function readEditorSnippetFiles(directory: string) {
  const roots = [join(app.getPath("home"), ".lfcode", "snippets")]
  if (isAbsolute(directory)) roots.push(join(directory, ".lfcode", "snippets"))
  const files = await Promise.all(roots.map((root) => collectEditorSnippetFiles(root)))
  return files.flat()
}

async function collectEditorSnippetFiles(root: string, depth = 0): Promise<{ path: string; content: string }[]> {
  if (depth > 3) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = resolve(root, entry.name)
      if (relative(root, target).startsWith("..")) return []
      if (entry.isDirectory()) return collectEditorSnippetFiles(target, depth + 1)
      if (!entry.isFile() || !/\.(json|code-snippets)$/i.test(entry.name)) return []
      const content = await readFile(target, "utf8").catch(() => undefined)
      if (!content || Buffer.byteLength(content) > 512 * 1024) return []
      return [{ path: target, content }]
    }),
  )
  return nested.flat()
}

export function sendDetachedSidePanelEvent(win: BrowserWindow, event: DetachedSidePanelEvent) {
  win.webContents.send("detached-side-panel-event", event)
}

export function sendBrowserPasswordCapture(win: BrowserWindow, event: BrowserPasswordCapturePrompt) {
  win.webContents.send("browser-password-capture", event)
}
