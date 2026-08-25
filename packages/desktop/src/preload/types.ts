import type {
  BrowserCacheOverview,
  BrowserCookieIdentity,
  BrowserCookieRecord,
  BrowserPasswordCapturePrompt,
  BrowserPasswordPromptAck,
  BrowserPasswordStorageState,
  SavedBrowserLoginRecord,
  SavedBrowserLoginUpsert,
} from "@lfcode-ai/shared/desktop-browser-management"

export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowVisibility = boolean

export type WindowConfig = {
  updaterEnabled: boolean
}

export type MobileAccessStatus = {
  enabled: boolean
  hostID?: string
  port?: number
  spkiSha256?: string
  endpoints?: string[]
  certificateStale?: boolean
  pendingEndpoints?: string[]
  certificateUpdated?: { at: number; reason: "network_changed" | "manual_reset" }
}

export type LanAccessDevice = {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

export type LanBrowserPairing = {
  url: string
  expiresAt: number
}

export type BrowserGuestTarget = {
  sourceWindowID: number
  tabID: string
  sessionKey?: string
  sessionID?: string
}

export type BrowserGuestReadyTarget = BrowserGuestTarget & {
  guestID: number
}

export type BrowserStateSync = {
  sessionKey: string
  tabID: string
  url?: string
  input?: string
  title?: string
  loading?: boolean
  error?: string
  closed?: true
}

export type BrowserSiteDataResult = {
  url: string
  origin?: string
  clearedCookies: number
}

export type BrowserReferenceCandidate = {
  label?: string
  text?: string
  url?: string
  title?: string
  selector?: string
  mode?: "selection" | "element"
}

export type BrowserReferenceState = {
  selection?: BrowserReferenceCandidate
  element?: BrowserReferenceCandidate
}

export type BrowserWindowOpenRequest = {
  sessionKey?: string
  sessionID?: string
  url: string
  title?: string
  reason?: "human" | "tool"
  presentation?: "headless" | "detached" | "sidebar"
}

export type DetachedSidePanelKind = "file" | "browser" | "review"

export type DetachedSidePanelRecord = {
  detachedWindowID: string
  sessionKey: string
  tab: string
  kind: DetachedSidePanelKind
  sourceWindowID: number
  title?: string
}

export type DetachedSidePanelEvent =
  | {
      type: "sync"
      records: DetachedSidePanelRecord[]
    }
  | {
      type: "dock-target"
      detachedWindowID: string
      active: boolean
    }
  | {
      type: "prepare-redock"
      detachedWindowID: string
    }
  | {
      type: "redock"
      detachedWindowID: string
      placement?: {
        afterTab?: string
        beforeTab?: string
      }
    }

export type AutomationEventPayload = {
  type: string
  windowID?: number
  data?: unknown
}

export type NativeFileTransfer = {
  dropzone?: string
  paths: string[]
  images: string[]
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  getMobileAccessStatus: () => Promise<MobileAccessStatus>
  enableMobileAccess: () => Promise<MobileAccessStatus>
  disableMobileAccess: () => Promise<MobileAccessStatus>
  applyMobileAccessNetworkChange: () => Promise<MobileAccessStatus>
  revokeMobileDevice: (deviceID: string) => Promise<void>
  listMobileDevices: () => Promise<LanAccessDevice[]>
  createLanBrowserPairing: () => Promise<LanBrowserPairing>
  resetMobileAccessCertificate: () => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  createDetachedSidePanelWindow: (input: {
    detachedWindowID: string
    route: string
    sessionKey: string
    tab: string
    kind: DetachedSidePanelKind
    title?: string
    background?: boolean
  }) => Promise<void>
  redockDetachedSidePanelWindow: (
    detachedWindowID: string,
    placement?: {
      afterTab?: string
      beforeTab?: string
    },
  ) => Promise<void>
  setDetachedDockTarget: (input: {
    sessionKey: string
    rect: { x: number; y: number; width: number; height: number }
  }) => Promise<void>
  clearDetachedDockTarget: () => Promise<void>

  getWindowCount: () => Promise<number>
  getWindowID: () => Promise<number | null>
  getWindowVisibility: () => Promise<WindowVisibility>
  getRendererMemoryInfo: () => Promise<{ private: number; shared: number; residentSet: number }>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
  onWindowVisibility: (cb: (visible: WindowVisibility) => void) => () => void
  onBrowserWindowOpen: (cb: (detail: BrowserWindowOpenRequest) => void) => () => void
  onBrowserPasswordCapture: (cb: (event: BrowserPasswordCapturePrompt) => void) => () => void
  onBrowserState: (cb: (event: BrowserStateSync) => void) => () => void
  onDetachedSidePanelEvent: (cb: (event: DetachedSidePanelEvent) => void) => () => void
  onNativeFileTransfer: (cb: (transfer: NativeFileTransfer) => void) => () => void
  automationEvent: (payload: AutomationEventPayload) => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  openAttachmentPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openExternalLink: (url: string) => void
  openBrowserDevTools: (target: BrowserGuestTarget) => Promise<void>
  clearBrowserSiteData: (target: BrowserGuestTarget) => Promise<BrowserSiteDataResult>
  getBrowserReferenceState: (target: BrowserGuestTarget) => Promise<BrowserReferenceState | null>
  getBrowserCacheOverview: () => Promise<BrowserCacheOverview>
  clearBrowserCache: () => Promise<BrowserCacheOverview>
  listBrowserCookies: () => Promise<BrowserCookieRecord[]>
  removeBrowserCookie: (cookie: BrowserCookieIdentity) => Promise<void>
  clearBrowserCookiesByDomain: (domain: string) => Promise<number>
  clearAllBrowserCookies: () => Promise<number>
  getBrowserPasswordStorageState: () => Promise<BrowserPasswordStorageState>
  listSavedBrowserLogins: () => Promise<SavedBrowserLoginRecord[]>
  upsertSavedBrowserLogin: (input: SavedBrowserLoginUpsert) => Promise<SavedBrowserLoginRecord>
  deleteSavedBrowserLogin: (id: string) => Promise<void>
  acknowledgeBrowserSavePasswordPrompt: (input: BrowserPasswordPromptAck) => Promise<SavedBrowserLoginRecord | null>
  registerBrowserGuest: (target: BrowserGuestTarget & { guestID: number }) => Promise<void>
  markBrowserGuestReady: (target: BrowserGuestReadyTarget) => Promise<void>
  unregisterBrowserGuest: (target: BrowserGuestTarget & { guestID?: number }) => Promise<void>
  setActiveBrowserTab: (target: BrowserGuestTarget & { active: boolean }) => Promise<void>
  reportBrowserState: (input: BrowserStateSync) => Promise<void>
  openPath: (path: string, app?: string) => Promise<void>
  statPath: (path: string) => Promise<{ exists: boolean; kind: "file" | "directory" | "unknown" }>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  getPathForFile: (file: File) => string
  readDroppedImage: (path: string) => Promise<{ dataUrl: string; filename: string; mime: string } | null>
  readEditorSnippets: (directory: string) => Promise<{ path: string; content: string }[]>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
}
