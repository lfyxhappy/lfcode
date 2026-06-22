import { execFile } from "node:child_process"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type {
  BrowserCookieIdentity,
  BrowserPasswordCapturePrompt,
  BrowserPasswordCapturePayload,
  BrowserPasswordPromptAck,
  BrowserPasswordStorageState,
  SavedBrowserLoginRecord,
  SavedBrowserLoginUpsert,
} from "@lfcode-ai/shared/desktop-browser-management"

import type {
  BrowserGuestTarget,
  BrowserSiteDataResult,
  DetachedSidePanelEvent,
  DetachedSidePanelRecord,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import { openExternal } from "./external"
import { getStore } from "./store"
import { setTitlebar } from "./windows"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

type Deps = {
  killSidecar: () => void
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  createDetachedSidePanelWindow: (input: {
    detachedWindowID: string
    route: string
    sessionKey: string
    tab: string
    kind: "file" | "browser" | "review" | "context"
    title?: string
    sourceWindowID: number
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
  unregisterBrowserGuest: (target: BrowserGuestTarget & { guestID?: number }) => Promise<void> | void
  openBrowserDevTools: (target: BrowserGuestTarget) => Promise<void> | void
  clearBrowserSiteData: (target: BrowserGuestTarget) => Promise<BrowserSiteDataResult> | BrowserSiteDataResult
  listBrowserCookies: () => Promise<any[]> | any[]
  removeBrowserCookie: (cookie: BrowserCookieIdentity) => Promise<void> | void
  clearBrowserCookiesByDomain: (domain: string) => Promise<number> | number
  clearAllBrowserCookies: () => Promise<number> | number
  getBrowserPasswordStorageState: () => Promise<BrowserPasswordStorageState> | BrowserPasswordStorageState
  listSavedBrowserLogins: () => Promise<SavedBrowserLoginRecord[]> | SavedBrowserLoginRecord[]
  upsertSavedBrowserLogin: (input: SavedBrowserLoginUpsert) => Promise<SavedBrowserLoginRecord> | SavedBrowserLoginRecord
  deleteSavedBrowserLogin: (id: string) => Promise<void> | void
  acknowledgeBrowserSavePasswordPrompt: (input: BrowserPasswordPromptAck) => Promise<SavedBrowserLoginRecord | null> | SavedBrowserLoginRecord | null
  resolveBrowserAutofill: (origin: string) => Promise<{ username: string; password: string } | null> | { username: string; password: string } | null
  captureBrowserPassword: (input: { guestID: number; payload: BrowserPasswordCapturePayload }) => Promise<void> | void
  setActiveBrowserTab: (target: BrowserGuestTarget & { active: boolean }) => Promise<void> | void
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
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
  ipcMain.handle(
    "create-detached-side-panel-window",
    (event: IpcMainInvokeEvent, input: Omit<DetachedSidePanelRecord, "sourceWindowID"> & { route: string }) => {
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

  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender)
    win?.webContents.send("browser-window-open", url)
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
  ipcMain.handle("browser-request-autofill", (_event: IpcMainInvokeEvent, origin: string) => {
    return deps.resolveBrowserAutofill(origin)
  })
  ipcMain.on("browser-password-capture", (event: IpcMainEvent, payload: BrowserPasswordCapturePayload) => {
    return deps.captureBrowserPassword({
      guestID: event.sender.id,
      payload,
    })
  })
  ipcMain.handle("set-active-browser-tab", (_event: IpcMainInvokeEvent, target: BrowserGuestTarget & { active: boolean }) => {
    return deps.setActiveBrowserTab(target)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)
  ipcMain.handle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.id ?? null
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

export function sendDetachedSidePanelEvent(win: BrowserWindow, event: DetachedSidePanelEvent) {
  win.webContents.send("detached-side-panel-event", event)
}

export function sendBrowserPasswordCapture(win: BrowserWindow, event: BrowserPasswordCapturePrompt) {
  win.webContents.send("browser-password-capture", event)
}
