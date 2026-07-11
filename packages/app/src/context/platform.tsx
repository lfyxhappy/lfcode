import { createSimpleContext } from "@lfcode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
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
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type UpdateInfo = { updateAvailable: boolean; version?: string }
type RendererMemoryInfo = { private: number; shared: number; residentSet: number }
type BrowserGuestTarget = {
  sourceWindowID: number
  tabID: string
  sessionKey?: string
  sessionID?: string
}
type BrowserGuestReadyTarget = BrowserGuestTarget & {
  guestID: number
}
type BrowserSiteDataResult = {
  url: string
  origin?: string
  clearedCookies: number
}
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
type BrowserOpenRequestDetail = {
  sessionKey?: string
  sessionID?: string
  reason?: "human" | "tool"
}
type DetachedSidePanelKind = "file" | "browser" | "review" | "context"
type DetachedSidePanelRecord = {
  detachedWindowID: string
  sessionKey: string
  tab: string
  kind: DetachedSidePanelKind
  sourceWindowID: number
  title?: string
}
type DetachedSidePanelEvent =
  | { type: "sync"; records: DetachedSidePanelRecord[] }
  | { type: "dock-target"; detachedWindowID: string; active: boolean }
  | { type: "prepare-redock"; detachedWindowID: string }
  | {
      type: "redock"
      detachedWindowID: string
      placement?: {
        afterTab?: string
        beforeTab?: string
      }
    }

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop"

  /** Desktop OS (Tauri only) */
  os?: "macos" | "windows" | "linux"

  /** App version */
  version?: string

  getWindowID?(): Promise<number | null>
  getRendererMemoryInfo?(): Promise<RendererMemoryInfo>

  /** Open a URL in the default browser */
  openLink(url: string, detail?: BrowserOpenRequestDetail): void

  /** Open a URL in the system browser */
  openExternalLink?(url: string): void

  openBrowserDevTools?(target: BrowserGuestTarget): Promise<void>

  clearBrowserSiteData?(target: BrowserGuestTarget): Promise<BrowserSiteDataResult>

  getBrowserReferenceState?(target: BrowserGuestTarget): Promise<BrowserReferenceState | null>

  getBrowserCacheOverview?(): Promise<BrowserCacheOverview>

  clearBrowserCache?(): Promise<BrowserCacheOverview>

  listBrowserCookies?(): Promise<BrowserCookieRecord[]>

  removeBrowserCookie?(cookie: BrowserCookieIdentity): Promise<void>

  clearBrowserCookiesByDomain?(domain: string): Promise<number>

  clearAllBrowserCookies?(): Promise<number>

  getBrowserPasswordStorageState?(): Promise<BrowserPasswordStorageState>

  listSavedBrowserLogins?(): Promise<SavedBrowserLoginRecord[]>

  upsertSavedBrowserLogin?(input: SavedBrowserLoginUpsert): Promise<SavedBrowserLoginRecord>

  deleteSavedBrowserLogin?(id: string): Promise<void>

  acknowledgeBrowserSavePasswordPrompt?(input: BrowserPasswordPromptAck): Promise<SavedBrowserLoginRecord | null>

  onBrowserPasswordCapture?(cb: (event: BrowserPasswordCapturePrompt) => void): () => void

  registerBrowserGuest?(target: BrowserGuestTarget & { guestID: number }): Promise<void>

  markBrowserGuestReady?(target: BrowserGuestReadyTarget): Promise<void>

  unregisterBrowserGuest?(target: BrowserGuestTarget & { guestID?: number }): Promise<void>

  setActiveBrowserTab?(target: BrowserGuestTarget & { active: boolean }): Promise<void>

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog (native on Tauri, server-backed on web) */
  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  /** Open native file picker dialog (Tauri only) */
  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  /** Save file picker dialog (Tauri only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Check for updates (Tauri only) */
  checkUpdate?(): Promise<UpdateInfo>

  /** Install updates (Tauri only) */
  update?(): Promise<void>

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Get the configured WSL integration (desktop only) */
  getWslEnabled?(): Promise<boolean>

  /** Set the configured WSL integration (desktop only) */
  setWslEnabled?(config: boolean): Promise<void> | void

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Resolve a native desktop file object to its filesystem path. */
  getPathForFile?(file: File): string

  /** Read a user-dropped image from an already-resolved absolute path. */
  readDroppedImage?(path: string): Promise<{ dataUrl: string; filename: string; mime: string } | null>

  /** Receive desktop-native file transfers resolved by the preload bridge. */
  onNativeFileTransfer?(cb: (transfer: { dropzone?: string; paths: string[]; images: string[] }) => void): () => void

  createDetachedSidePanelWindow?(input: {
    detachedWindowID: string
    route: string
    sessionKey: string
    tab: string
    kind: DetachedSidePanelKind
    title?: string
  }): Promise<void>
  redockDetachedSidePanelWindow?(
    detachedWindowID: string,
    placement?: {
      afterTab?: string
      beforeTab?: string
    },
  ): Promise<void>
  setDetachedDockTarget?(input: {
    sessionKey: string
    rect: { x: number; y: number; width: number; height: number }
  }): Promise<void>
  clearDetachedDockTarget?(): Promise<void>
  onDetachedSidePanelEvent?(cb: (event: DetachedSidePanelEvent) => void): () => void
}

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
