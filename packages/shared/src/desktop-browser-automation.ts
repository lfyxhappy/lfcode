const desktopBrowserAutomationKey = Symbol.for("lfcode.desktop-browser-automation")

export type DesktopBrowserAutomationTarget = {
  sourceWindowID: number
  tabID: string
  url: string
  title: string
  sessionKey?: string
  sessionID?: string
}

export type DesktopBrowserAutomationElement = {
  ref: string
  selector: string
  tag: string
  role?: string
  text?: string
  placeholder?: string
  value?: string
  href?: string
  disabled: boolean
  checked: boolean
  focused: boolean
}

export type DesktopBrowserAutomationSnapshot = {
  target: DesktopBrowserAutomationTarget
  elements: DesktopBrowserAutomationElement[]
  text: string
}

export type DesktopBrowserAutomationScreenshot = {
  target: DesktopBrowserAutomationTarget
  path: string
  width: number
  height: number
}

export type DesktopBrowserAutomationPageHeading = {
  level: number
  text: string
  selector: string
}

export type DesktopBrowserAutomationPageLandmark = {
  role: string
  text?: string
  selector: string
}

export type DesktopBrowserAutomationResourceSource = {
  kind:
    | "src"
    | "currentSrc"
    | "srcset"
    | "source"
    | "poster"
    | "href"
    | "background-image"
    | "meta"
    | "favicon"
    | "track"
    | "network"
    | "blob-export"
    | "data-export"
    | "canvas-export"
  url: string
  mimeGuess?: string
  mimeType?: string
  label?: string
  statusCode?: number
  contentDisposition?: string
  requested?: boolean
}

export type DesktopBrowserAutomationResourceLimitation =
  | "blob"
  | "data"
  | "mse"
  | "cross-origin-restricted"
  | "not-found-in-network"
  | "canvas-export-required"

export type DesktopBrowserAutomationResourceRecommendedAction =
  | "browser_download_resource"
  | "browser_capture_element"
  | "browser_get_network"
  | "browser_scroll"
  | "browser_wait_for_load_state"

export type DesktopBrowserAutomationMediaTrack = {
  kind?: string
  label?: string
  language?: string
  src?: string
  default?: boolean
}

export type DesktopBrowserAutomationPageMedia = {
  kind: "image" | "video" | "audio" | "svg" | "canvas"
  resourceID: string
  tagName: string
  selector: string
  text?: string
  alt?: string
  title?: string
  ariaLabel?: string
  src?: string
  currentSrc?: string
  srcset?: string
  poster?: string
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
  duration?: number
  currentTime?: number
  paused?: boolean
  controls?: boolean
  muted?: boolean
  loop?: boolean
  autoplay?: boolean
  backgroundImage?: string
  pageHint?: "background-image" | "favicon" | "og:image" | "twitter:image"
  downloadable?: boolean
  reason?: string
  limitation?: DesktopBrowserAutomationResourceLimitation
  recommendedAction?: DesktopBrowserAutomationResourceRecommendedAction
  recommendedReason?: string
  primarySource?: DesktopBrowserAutomationResourceSource
  sources?: DesktopBrowserAutomationResourceSource[]
  tracks?: DesktopBrowserAutomationMediaTrack[]
  visible: boolean
}

export type DesktopBrowserAutomationPage = {
  target: DesktopBrowserAutomationTarget
  title: string
  url: string
  readyState: string
  text: string
  headings: DesktopBrowserAutomationPageHeading[]
  landmarks: DesktopBrowserAutomationPageLandmark[]
  interactive: DesktopBrowserAutomationElement[]
  media: DesktopBrowserAutomationPageMedia[]
}

export type DesktopBrowserAutomationResource = DesktopBrowserAutomationPageMedia & {
  href?: string
  download?: string
}

export type DesktopBrowserAutomationResourceSnapshot = {
  target: DesktopBrowserAutomationTarget
  resources: DesktopBrowserAutomationResource[]
}

export type DesktopBrowserAutomationElementCapture = {
  target: DesktopBrowserAutomationTarget
  selector: string
  path: string
  width: number
  height: number
  viewport: {
    width: number
    height: number
  }
  deviceScaleFactor: number
}

export type DesktopBrowserAutomationConsoleEntry = {
  level: "log" | "warning" | "error" | "debug" | "info"
  kind?: "console" | "pageerror" | "unhandledrejection"
  message: string
  sourceId?: string
  line?: number
  column?: number
  stack?: string
  time: number
}

export type DesktopBrowserAutomationConsoleLog = {
  target: DesktopBrowserAutomationTarget
  entries: DesktopBrowserAutomationConsoleEntry[]
}

export type DesktopBrowserAutomationNetworkEntry = {
  url: string
  method: string
  resourceType?: string
  statusCode?: number
  fromCache?: boolean
  mimeType?: string
  contentDisposition?: string
  error?: string
  time: number
}

export type DesktopBrowserAutomationNetworkLog = {
  target: DesktopBrowserAutomationTarget
  entries: DesktopBrowserAutomationNetworkEntry[]
}

export type DesktopBrowserAutomationCachedResourceEntry = {
  url: string
  method: string
  resourceType?: string
  statusCode?: number
  fromCache?: boolean
  cacheObserved: boolean
  mimeType?: string
  contentDisposition?: string
  lastSeenAt: number
  observations: number
  sourceWindowID?: number
  tabID?: string
  sessionKey?: string
  sessionID?: string
}

export type DesktopBrowserAutomationCachedResourceList = {
  cacheSizeBytes: number
  indexedEntryCount: number
  entries: DesktopBrowserAutomationCachedResourceEntry[]
}

export type DesktopBrowserAutomationCachePolicy = "prefer-cache" | "cache-only" | "bypass-cache"

export type DesktopBrowserAutomationDownloadSourceKind =
  | "cache"
  | "network"
  | "blob-export"
  | "data-export"
  | "canvas-export"
  | "cache-miss"

export type DesktopBrowserAutomationDownload = {
  target: DesktopBrowserAutomationTarget
  ok: boolean
  cachePolicy: DesktopBrowserAutomationCachePolicy
  cacheObserved: boolean
  cacheHit: boolean
  fallbackUsed: boolean
  sourceKind: DesktopBrowserAutomationDownloadSourceKind
  missReason?: "cache-miss"
  resourceID?: string
  url: string
  resolvedUrl?: string
  path?: string
  filename?: string
  mime?: string
  bytes?: number
}

export type DesktopBrowserAutomationWaitResult = {
  matched: boolean
  target: DesktopBrowserAutomationTarget
  detail?: string
}

export type DesktopBrowserAutomationSessionInput = {
  sessionKey: string
  tabID?: string
}

export interface DesktopBrowserAutomationBridge {
  getTarget(input: DesktopBrowserAutomationSessionInput): DesktopBrowserAutomationTarget | undefined
  navigate(
    input: {
      sessionKey: string
      tabID?: string
      sessionID?: string
      url: string
      title?: string
      presentation?: "headless" | "detached" | "sidebar"
      newTab?: boolean
    },
  ): Promise<DesktopBrowserAutomationTarget>
  snapshot(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationSnapshot>
  screenshot(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationScreenshot>
  readPage(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationPage>
  extractResource(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationResourceSnapshot>
  captureElement(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationElementCapture>
  getConsole(input: DesktopBrowserAutomationSessionInput & { limit?: number }): Promise<DesktopBrowserAutomationConsoleLog>
  getNetwork(input: DesktopBrowserAutomationSessionInput & { limit?: number }): Promise<DesktopBrowserAutomationNetworkLog>
  listCachedResources(
    input: {
      sessionKey: string
      tabID?: string
      query?: string
      url?: string
      limit?: number
      resourceTypes?: string[]
    },
  ): Promise<DesktopBrowserAutomationCachedResourceList>
  downloadResource(
    input: {
      sessionKey: string
      tabID?: string
      url?: string
      filename?: string
      resourceID?: string
      ref?: string
      selector?: string
      cachePolicy?: DesktopBrowserAutomationCachePolicy
    },
  ): Promise<DesktopBrowserAutomationDownload>
  click(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationTarget>
  type(input: DesktopBrowserAutomationSessionInput & { ref: string; text: string; submit?: boolean }): Promise<DesktopBrowserAutomationTarget>
  scroll(
    input: {
      sessionKey: string
      tabID?: string
      ref?: string
      selector?: string
      direction?: "up" | "down" | "left" | "right"
      amount?: number
    },
  ): Promise<DesktopBrowserAutomationTarget>
  /**
   * @deprecated Browser automation is non-preemptive. This compatibility method rejects rather than simulating pointer input.
   */
  hover(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationTarget>
  /**
   * @deprecated Browser automation is non-preemptive. This compatibility method rejects rather than moving focus.
   */
  focus(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationTarget>
  clear(input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string }): Promise<DesktopBrowserAutomationTarget>
  selectOption(
    input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string; value?: string; label?: string; text?: string },
  ): Promise<DesktopBrowserAutomationTarget>
  uploadFile(
    input: DesktopBrowserAutomationSessionInput & { ref?: string; selector?: string; files: string[] },
  ): Promise<DesktopBrowserAutomationTarget>
  /**
   * @deprecated Browser automation is non-preemptive. This compatibility method rejects rather than injecting key events.
   */
  pressKey(input: DesktopBrowserAutomationSessionInput & { key: string }): Promise<DesktopBrowserAutomationTarget>
  back(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationTarget>
  forward(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationTarget>
  reload(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationTarget>
  close(input: DesktopBrowserAutomationSessionInput): Promise<DesktopBrowserAutomationTarget | undefined>
  waitFor(input: DesktopBrowserAutomationSessionInput & { text?: string; textGone?: string; timeMs?: number; timeoutMs?: number }): Promise<DesktopBrowserAutomationWaitResult>
  waitForSelector(input: DesktopBrowserAutomationSessionInput & { selector: string; visible?: boolean; timeoutMs?: number; stableMs?: number }): Promise<DesktopBrowserAutomationWaitResult>
  waitForUrl(input: DesktopBrowserAutomationSessionInput & { url: string; match?: "equals" | "includes"; timeoutMs?: number; stableMs?: number }): Promise<DesktopBrowserAutomationWaitResult>
  waitForLoadState(
    input: {
      sessionKey: string
      tabID?: string
      state: "domcontentloaded" | "load" | "networkidle"
      timeoutMs?: number
      stableMs?: number
    },
  ): Promise<DesktopBrowserAutomationWaitResult>
  waitForNavigation(
    input: {
      sessionKey: string
      tabID?: string
      url?: string
      match?: "equals" | "includes"
      timeoutMs?: number
      stableMs?: number
    },
  ): Promise<DesktopBrowserAutomationWaitResult>
}

type GlobalState = typeof globalThis & {
  [desktopBrowserAutomationKey]?: DesktopBrowserAutomationBridge
}

export function registerDesktopBrowserAutomationBridge(bridge: DesktopBrowserAutomationBridge) {
  ;(globalThis as GlobalState)[desktopBrowserAutomationKey] = bridge
}

export function getDesktopBrowserAutomationBridge() {
  return (globalThis as GlobalState)[desktopBrowserAutomationKey]
}
