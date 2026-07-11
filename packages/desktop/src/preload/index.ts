import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, InitStep, NativeFileTransfer, SqliteMigrationProgress } from "./types"

const nativeFileTransferListeners = new Set<(transfer: NativeFileTransfer) => void>()

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),
  createDetachedSidePanelWindow: (input) => ipcRenderer.invoke("create-detached-side-panel-window", input),
  redockDetachedSidePanelWindow: (detachedWindowID, placement) =>
    ipcRenderer.invoke("redock-detached-side-panel-window", detachedWindowID, placement),
  setDetachedDockTarget: (input) => ipcRenderer.invoke("set-detached-dock-target", input),
  clearDetachedDockTarget: () => ipcRenderer.invoke("clear-detached-dock-target"),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  getRendererMemoryInfo: () => ipcRenderer.invoke("get-renderer-memory-info"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
  onBrowserWindowOpen: (cb) => {
    const handler = (_: unknown, detail: any) => cb(detail)
    ipcRenderer.on("browser-window-open", handler)
    return () => ipcRenderer.removeListener("browser-window-open", handler)
  },
  onBrowserPasswordCapture: (cb) => {
    const handler = (_: unknown, event: any) => cb(event)
    ipcRenderer.on("browser-password-capture", handler)
    return () => ipcRenderer.removeListener("browser-password-capture", handler)
  },
  onDetachedSidePanelEvent: (cb) => {
    const handler = (_: unknown, event: any) => cb(event)
    ipcRenderer.on("detached-side-panel-event", handler)
    return () => ipcRenderer.removeListener("detached-side-panel-event", handler)
  },
  onNativeFileTransfer: (cb) => {
    nativeFileTransferListeners.add(cb)
    return () => nativeFileTransferListeners.delete(cb)
  },
  automationEvent: (payload) => ipcRenderer.send("automation-event", payload),

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openExternalLink: (url) => ipcRenderer.send("open-external-link", url),
  openBrowserDevTools: (target) => ipcRenderer.invoke("open-browser-devtools", target),
  clearBrowserSiteData: (target) => ipcRenderer.invoke("clear-browser-site-data", target),
  getBrowserReferenceState: (target) => ipcRenderer.invoke("get-browser-reference-state", target),
  getBrowserCacheOverview: () => ipcRenderer.invoke("get-browser-cache-overview"),
  clearBrowserCache: () => ipcRenderer.invoke("clear-browser-cache"),
  listBrowserCookies: () => ipcRenderer.invoke("list-browser-cookies"),
  removeBrowserCookie: (cookie) => ipcRenderer.invoke("remove-browser-cookie", cookie),
  clearBrowserCookiesByDomain: (domain) => ipcRenderer.invoke("clear-browser-cookies-by-domain", domain),
  clearAllBrowserCookies: () => ipcRenderer.invoke("clear-all-browser-cookies"),
  getBrowserPasswordStorageState: () => ipcRenderer.invoke("get-browser-password-storage-state"),
  listSavedBrowserLogins: () => ipcRenderer.invoke("list-saved-browser-logins"),
  upsertSavedBrowserLogin: (input) => ipcRenderer.invoke("upsert-saved-browser-login", input),
  deleteSavedBrowserLogin: (id) => ipcRenderer.invoke("delete-saved-browser-login", id),
  acknowledgeBrowserSavePasswordPrompt: (input) => ipcRenderer.invoke("acknowledge-browser-save-password-prompt", input),
  registerBrowserGuest: (target) => ipcRenderer.invoke("register-browser-guest", target),
  markBrowserGuestReady: (target) => ipcRenderer.invoke("mark-browser-guest-ready", target),
  unregisterBrowserGuest: (target) => ipcRenderer.invoke("unregister-browser-guest", target),
  setActiveBrowserTab: (target) => ipcRenderer.invoke("set-active-browser-tab", target),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readDroppedImage: (path) => ipcRenderer.invoke("read-dropped-image", path),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
}

const droppedImage = (file: Pick<File, "name" | "type"> | string): boolean => {
  if (typeof file === "string") return /\.(avif|gif|jpe?g|png|webp)$/i.test(file)
  return file.type.startsWith("image/") || droppedImage(file.name)
}

function emitNativeFileTransfer(transfer: NativeFileTransfer) {
  for (const listener of nativeFileTransferListeners) listener(transfer)
}

async function forwardNativeTransfer(event: ClipboardEvent | DragEvent, type: "lfcode:native-file-drop" | "lfcode:native-file-paste") {
  const target = event.target
  if (!(target instanceof Element)) return
  const root = target.closest<HTMLElement>("[data-session-dropzone]")
  if (!root) return

  const transfer = "clipboardData" in event ? event.clipboardData : event.dataTransfer
  const files = transfer ? Array.from(transfer.files) : []
  const transferTypes = transfer ? Array.from(transfer.types) : []
  if (files.length === 0) {
    ipcRenderer.send("automation-event", {
      type: "session.native-transfer.empty",
      data: { type, transferTypes },
    })
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()

  const filesByKind = files.reduce(
    (result, file) => {
      const path = webUtils.getPathForFile(file)
      if (!path) return result
      if (droppedImage(file)) result.images.push(path)
      else result.paths.push(path)
      return result
    },
    { paths: [] as string[], images: [] as string[] },
  )
  if (type === "lfcode:native-file-paste" && filesByKind.paths.length + filesByKind.images.length < files.length) {
    const clipboardPaths = await ipcRenderer.invoke("read-clipboard-file-paths").catch(() => [] as string[])
    for (const path of clipboardPaths) {
      if (droppedImage(path)) filesByKind.images.push(path)
      else filesByKind.paths.push(path)
    }
  }
  filesByKind.paths = [...new Set(filesByKind.paths)]
  filesByKind.images = [...new Set(filesByKind.images)]
  if (filesByKind.paths.length === 0 && filesByKind.images.length === 0) {
    ipcRenderer.send("automation-event", {
      type: "session.native-transfer.unresolved",
      data: { type, transferTypes, files: files.length },
    })
    return
  }

  ipcRenderer.send("automation-event", {
    type: "session.native-transfer.accepted",
    data: {
      type,
      transferTypes,
      files: files.length,
      paths: filesByKind.paths.length,
      images: filesByKind.images.length,
    },
  })
  emitNativeFileTransfer({
    dropzone: root.dataset.sessionDropzone,
    paths: filesByKind.paths,
    images: filesByKind.images,
  })
}

window.addEventListener("drop", (event) => void forwardNativeTransfer(event, "lfcode:native-file-drop"), true)
window.addEventListener("paste", (event) => void forwardNativeTransfer(event, "lfcode:native-file-paste"), true)

contextBridge.exposeInMainWorld("api", api)
