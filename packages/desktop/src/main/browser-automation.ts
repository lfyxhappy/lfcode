import { mkdir, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { isAbsolute, join, relative, resolve } from "node:path"
import { app, BrowserWindow, type DownloadItem, type Event, type WebContents } from "electron"
import {
  registerDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationCachePolicy,
  type DesktopBrowserAutomationCachedResourceList,
  type DesktopBrowserAutomationConsoleLog,
  type DesktopBrowserAutomationElement,
  type DesktopBrowserAutomationElementCapture,
  type DesktopBrowserAutomationDownload,
  type DesktopBrowserAutomationDownloadSourceKind,
  type DesktopBrowserAutomationNetworkLog,
  type DesktopBrowserAutomationPage,
  type DesktopBrowserAutomationPageMedia,
  type DesktopBrowserAutomationResourceLimitation,
  type DesktopBrowserAutomationResource,
  type DesktopBrowserAutomationResourceSource,
  type DesktopBrowserAutomationResourceSnapshot,
  type DesktopBrowserAutomationScreenshot,
  type DesktopBrowserAutomationSnapshot,
  type DesktopBrowserAutomationTarget,
} from "@lfcode-ai/shared/desktop-browser-automation"
import {
  type BrowserNetworkEntry,
  getBrowserTargetForSession,
  getReadyBrowserTargetForSession,
  hasBrowserTargetForSession,
  refreshBrowserGuestPerformance,
  findBrowserCachedResourceByUrl,
  listBrowserConsoleForSession,
  listBrowserCachedResources,
  listBrowserNetworkForSession,
} from "./browser-runtime"
import { callRendererAutomation } from "./automation-renderer"
import { AutomationHttpError, browserAutomationError } from "../automation-security"

const SNAPSHOT_LIMIT = 200
const PAGE_TEXT_LIMIT = 8_000
const HEADING_LIMIT = 24
const LANDMARK_LIMIT = 24
const MEDIA_LIMIT = 48
const DEFAULT_WAIT_TIMEOUT_MS = 10_000
// Keep semantic waits responsive during rapid model-driven UI tests. Event
// handlers remain the fast path; this interval only backs polling operations.
const WAIT_POLL_MS = 50
const WAIT_POLL_MAX_MS = 250
const NETWORK_IDLE_STABLE_MS = 600
const OPEN_BROWSER_TARGET_TIMEOUT_MS = 10_000
const READY_TARGET_POLL_MS = 25
const NAVIGATION_RETRY_DELAYS_MS = [150, 300, 600]
const DOWNLOAD_TIMEOUT_MS = 30_000
const DEFAULT_SCROLL_AMOUNT = 600
const CAPTURE_RETRY_LIMIT = 3
const CAPTURE_RETRY_DELAY_MS = 180

type ActiveBrowserAutomationTarget = {
  sourceWindowID: number
  tabID: string
  guest: WebContents
  sessionKey?: string
  sessionID?: string
}

type SnapshotRef = {
  selector: string
  guestID: number
  url: string
}

type RawSnapshotElement = {
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

type RawPage = Omit<DesktopBrowserAutomationPage, "target"> & {
  interactive: RawSnapshotElement[]
}

type RawResource = DesktopBrowserAutomationResource

type BrowserDownloadResult = {
  ok: boolean
  cacheObserved: boolean
  cacheHit: boolean
  fallbackUsed: boolean
  sourceKind: DesktopBrowserAutomationDownloadSourceKind
  missReason?: "cache-miss"
  resolvedUrl?: string
  path?: string
  filename?: string
  mime?: string
  bytes?: number
}

const snapshotRefs = new Map<string, Map<string, SnapshotRef>>()

export function registerBrowserAutomationBridge() {
  registerDesktopBrowserAutomationBridge({
    getTarget: (input) => {
      const target = getTargetForSession(input.sessionKey, input.tabID)
      if (input.tabID && !target) throw browserAutomationError("browser_tab_not_found")
      return target ? serializeTarget(target) : undefined
    },
    navigate: async (input) => {
      const url = normalizeURL(input.url)
      const target = input.newTab
        ? await ensureSessionTarget(input.sessionKey, input.sessionID, undefined, url, input.title, input.presentation, true)
        : (await ensureSessionTarget(input.sessionKey, input.sessionID, input.tabID, url, input.title, input.presentation)) ??
          (await requireTargetForSession(input.sessionKey, input.tabID))
      if (!target) throw browserAutomationError("browser_target_not_ready")
      await navigateTarget(target, input.sessionKey, url, input.newTab ? target.tabID : input.tabID)
      return serializeTarget(target)
    },
    snapshot: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const elements = await executeJSON<RawSnapshotElement[]>(target.guest, buildSnapshotScript(SNAPSHOT_LIMIT), { retryReadOnly: true })
      storeSnapshotRefs(target, elements)
      return {
        target: serializeTarget(target),
        elements,
        text: formatSnapshotText(elements),
      } satisfies DesktopBrowserAutomationSnapshot
    },
    screenshot: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const image = await captureGuestPage(target.guest)
      const size = image.getSize()
      const outputDir = join(app.getPath("userData"), "output", "browser-automation")
      await mkdir(outputDir, { recursive: true })
      const path = join(outputDir, `${sanitizeForPath(target.tabID)}-${Date.now()}.png`)
      await writeFile(path, image.toPNG())
      return {
        target: serializeTarget(target),
        path,
        width: size.width,
        height: size.height,
      } satisfies DesktopBrowserAutomationScreenshot
    },
    readPage: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const page = await executeJSON<RawPage>(
        target.guest,
        buildReadPageScript({
          textLimit: PAGE_TEXT_LIMIT,
          interactiveLimit: SNAPSHOT_LIMIT,
          headingLimit: HEADING_LIMIT,
          landmarkLimit: LANDMARK_LIMIT,
          mediaLimit: MEDIA_LIMIT,
        }),
        { retryReadOnly: true },
      )
      storeSnapshotRefs(target, page.interactive)
      const media = enrichResourcesWithNetwork(page.media, listBrowserNetworkForSession(input.sessionKey, 200, input.tabID))
      return {
        target: serializeTarget(target),
        title: page.title,
        url: page.url,
        readyState: page.readyState,
        text: page.text,
        headings: page.headings,
        landmarks: page.landmarks,
        interactive: page.interactive,
        media,
      } satisfies DesktopBrowserAutomationPage
    },
    extractResource: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const selector = input.ref ? requireSnapshotRef(target, input.ref).selector : input.selector
      const resources = await executeJSON<RawResource[]>(
        target.guest,
        buildExtractResourceScript({
          selector,
          limit: MEDIA_LIMIT,
        }),
        { retryReadOnly: true },
      )
      const enriched = enrichResourcesWithNetwork(resources, listBrowserNetworkForSession(input.sessionKey, 200, input.tabID))
      return {
        target: serializeTarget(target),
        resources: enriched,
      } satisfies DesktopBrowserAutomationResourceSnapshot
    },
    captureElement: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const selector = input.ref ? requireSnapshotRef(target, input.ref).selector : input.selector
      if (!selector) throw new Error("capture_element requires ref or selector")
      const rect = await executeJSON<{ selector: string; x: number; y: number; width: number; height: number }>(
        target.guest,
        buildCaptureElementRectScript(selector),
        { retryReadOnly: true },
      )
      if (rect.width < 2 || rect.height < 2) {
        throw new Error(`Element is not visible enough to capture: ${selector}`)
      }
      const image = await captureGuestPage(target.guest, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })
      const size = image.getSize()
      const sourceWindow = BrowserWindow.fromId(target.sourceWindowID)
      const viewport = sourceWindow?.getContentSize() ?? [size.width, size.height]
      const deviceScaleFactor = sourceWindow?.webContents.getZoomFactor() ?? 1
      const outputDir = join(app.getPath("userData"), "output", "browser-automation")
      await mkdir(outputDir, { recursive: true })
      const path = join(outputDir, `${sanitizeForPath(target.tabID)}-element-${Date.now()}.png`)
      await writeFile(path, image.toPNG())
      return {
        target: serializeTarget(target),
        selector: rect.selector,
        path,
        width: size.width,
        height: size.height,
        viewport: { width: viewport[0], height: viewport[1] },
        deviceScaleFactor,
      } satisfies DesktopBrowserAutomationElementCapture
    },
    getConsole: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      return {
        target: serializeTarget(target),
        entries: listBrowserConsoleForSession(input.sessionKey, input.limit ?? 50, input.tabID),
      } satisfies DesktopBrowserAutomationConsoleLog
    },
    getNetwork: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      return {
        target: serializeTarget(target),
        entries: listBrowserNetworkForSession(input.sessionKey, input.limit ?? 50, input.tabID),
      } satisfies DesktopBrowserAutomationNetworkLog
    },
    listCachedResources: async (input) => {
      return listBrowserCachedResources({
        query: input.query,
        url: input.url,
        limit: input.limit,
        resourceTypes: input.resourceTypes,
      }) satisfies Promise<DesktopBrowserAutomationCachedResourceList>
    },
    downloadResource: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const resolved = await resolveDownloadRequest(target, input)
      const cachePolicy = input.cachePolicy ?? "prefer-cache"
      const download =
        resolved.mode === "download"
          ? await downloadBrowserResource(target, resolved.url, input.filename, cachePolicy)
          : await exportBrowserResource(target, resolved, input.filename)
      return {
        target: serializeTarget(target),
        ok: download.ok,
        cachePolicy,
        cacheObserved: download.cacheObserved,
        cacheHit: download.cacheHit,
        fallbackUsed: download.fallbackUsed,
        sourceKind: download.sourceKind,
        missReason: download.missReason,
        resourceID: resolved.resourceID,
        url: resolved.url,
        resolvedUrl: download.resolvedUrl,
        path: download.path,
        filename: download.filename,
        mime: download.mime,
        bytes: download.bytes,
      } satisfies DesktopBrowserAutomationDownload
    },
    scroll: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      await runScrollAction(target.guest, {
        selector: input.ref ? requireSnapshotRef(target, input.ref).selector : input.selector,
        direction: input.direction,
        amount: input.amount,
      })
      return serializeTarget(target)
    },
    hover: async () => {
      throw nonPreemptiveBrowserInteractionError("hover")
    },
    focus: async () => {
      throw nonPreemptiveBrowserInteractionError("focus")
    },
    clear: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      await runClearAction(target.guest, resolveElementSelector(target, input.ref, input.selector, "clear"))
      return serializeTarget(target)
    },
    selectOption: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      await runSelectOptionAction(target.guest, resolveElementSelector(target, input.ref, input.selector, "select_option"), input)
      return serializeTarget(target)
    },
    uploadFile: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const selector = resolveElementSelector(target, input.ref, input.selector, "upload_file")
      const files = await resolveUploadFiles(input.sessionKey, input.files)
      await runUploadFileAction(target.guest, selector, files)
      return serializeTarget(target)
    },
    click: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      await runSelectorAction(target.guest, resolveElementSelector(target, input.ref, input.selector, "click"), "click")
      return serializeTarget(target)
    },
    type: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const ref = requireSnapshotRef(target, input.ref)
      await runTypeAction(target.guest, ref.selector, input.text, input.submit === true)
      return serializeTarget(target)
    },
    pressKey: async () => {
      throw nonPreemptiveBrowserInteractionError("press_key")
    },
    back: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      if (!target.guest.navigationHistory.canGoBack()) {
        throw browserAutomationError("no_back_history")
      }
      const initialUrl = target.guest.getURL()
      clearSnapshotRefs(target)
      target.guest.navigationHistory.goBack()
      await ensureNavigationSettled(target.guest, initialUrl)
      return serializeTarget(target)
    },
    forward: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      if (!target.guest.navigationHistory.canGoForward()) {
        throw browserAutomationError("no_forward_history")
      }
      const initialUrl = target.guest.getURL()
      clearSnapshotRefs(target)
      target.guest.navigationHistory.goForward()
      await ensureNavigationSettled(target.guest, initialUrl)
      return serializeTarget(target)
    },
    reload: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const initialUrl = target.guest.getURL()
      clearSnapshotRefs(target)
      target.guest.reload()
      await ensureNavigationSettled(target.guest, initialUrl, true)
      return serializeTarget(target)
    },
    close: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const win = BrowserWindow.fromId(target.sourceWindowID)
      if (!win || win.isDestroyed()) {
        throw new Error(`Browser window ${target.sourceWindowID} is not available`)
      }
      clearSnapshotRefs(target)
      await callRendererAutomation(win, "browser.close", { tabID: target.tabID })
      await delay(100)
      if (isBackgroundDetachedBrowserWindow(win)) win.destroy()
      const next = getReadyTargetForSession(input.sessionKey, input.tabID)
      return next ? serializeTarget(next) : undefined
    },
    waitFor: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      if (input.timeMs && input.timeMs > 0) {
        await delay(input.timeMs)
        return {
          matched: true,
          target: serializeTarget(target),
        }
      }
      const matched = await waitForText(target.guest, {
        text: input.text,
        textGone: input.textGone,
        timeoutMs: input.timeoutMs,
      })
      return {
        matched,
        target: serializeTarget(target),
      }
    },
    waitForSelector: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const matched = await waitForSelector(target.guest, input)
      return {
        matched,
        target: serializeTarget(target),
        detail: matched ? `Selector matched: ${input.selector}` : `Timed out waiting for selector: ${input.selector}`,
      }
    },
    waitForUrl: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const matched = await waitForUrl(target.guest, input)
      return {
        matched,
        target: serializeTarget(target),
        detail: matched ? `URL matched: ${input.url}` : `Timed out waiting for URL: ${input.url}`,
      }
    },
    waitForLoadState: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const matched = await waitForLoadState(target.guest, input)
      return {
        matched,
        target: serializeTarget(target),
        detail: matched ? `Load state matched: ${input.state}` : `Timed out waiting for load state: ${input.state}`,
      }
    },
    waitForNavigation: async (input) => {
      const target = await requireTargetForSession(input.sessionKey, input.tabID)
      const matched = await waitForNavigation(target.guest, input)
      return {
        matched,
        target: serializeTarget(target),
        detail:
          matched
            ? input.url
              ? `Navigation matched URL: ${input.url}`
              : "Navigation completed."
            : input.url
              ? `Timed out waiting for navigation to URL: ${input.url}`
              : "Timed out waiting for navigation.",
      }
    },
  } satisfies DesktopBrowserAutomationBridge)
}

export function getBrowserAutomationTargetForSession(sessionKey: string, tabID?: string) {
  const target = getTargetForSession(sessionKey, tabID)
  return target ? serializeTarget(target) : undefined
}

function getTargetForSession(sessionKey: string, tabID?: string) {
  return getBrowserTargetForSession(sessionKey, tabID)
}

function getReadyTargetForSession(sessionKey: string, tabID?: string) {
  return getReadyBrowserTargetForSession(sessionKey, tabID)
}

async function requireTargetForSession(sessionKey: string, tabID?: string) {
  const target = getReadyTargetForSession(sessionKey, tabID)
  if (target) {
    refreshBrowserGuestPerformance({ sourceWindowID: target.sourceWindowID, tabID: target.tabID })
    return target
  }
  if (hasBrowserTargetForSession(sessionKey, tabID)) return waitForReadyTarget(sessionKey, OPEN_BROWSER_TARGET_TIMEOUT_MS, tabID)
  if (tabID) clearSnapshotRefsForTab(tabID)
  throw browserAutomationError(tabID ? "browser_tab_not_found" : "browser_target_missing")
}

async function ensureSessionTarget(
  sessionKey: string,
  sessionID: string | undefined,
  tabID: string | undefined,
  url: string,
  title: string | undefined,
  presentation: "headless" | "detached" | "sidebar" | undefined,
  newTab = false,
) {
  const requestedTabID = newTab ? createAutomationTabID() : tabID
  const existing = newTab ? undefined : getReadyTargetForSession(sessionKey, tabID)
  if (existing) return existing
  if (tabID && !newTab) return undefined

  const win = getBrowserOpenWindow(sessionKey)
  if (!win) return undefined

  win.webContents.send("browser-window-open", {
    sessionKey,
    sessionID,
    url,
    title,
    presentation,
    reason: "tool",
    newTab,
    tabID: requestedTabID,
  })
  return waitForReadyTarget(sessionKey, OPEN_BROWSER_TARGET_TIMEOUT_MS, requestedTabID)
}

function createAutomationTabID() {
  return `b_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function getBrowserOpenWindow(sessionKey: string) {
  const sessionWindow = findWindowForSession(sessionKey)
  if (sessionWindow) return sessionWindow
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && !isDetachedSidePanelWindow(focused)) return focused
  return BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !isDetachedSidePanelWindow(item))
}

function isDetachedSidePanelWindow(win: BrowserWindow) {
  return win.webContents.getURL().includes("detachedWindowID=")
}

function isBackgroundDetachedBrowserWindow(win: BrowserWindow) {
  return isDetachedSidePanelWindow(win) && !win.isVisible() && !win.isMinimized()
}

function findWindowForSession(sessionKey: string) {
  const [dir, sessionID] = sessionKey.split("/")
  if (!dir || !sessionID) return undefined
  const routeNeedle = `#/${dir}/session/${sessionID}`
  return BrowserWindow.getAllWindows().find((item) => {
    if (item.isDestroyed() || isDetachedSidePanelWindow(item)) return false
    return item.webContents.getURL().includes(routeNeedle)
  })
}

async function waitForReadyTarget(sessionKey: string, timeoutMs: number, tabID?: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const target = getReadyTargetForSession(sessionKey, tabID)
    if (target) return target
    await delay(READY_TARGET_POLL_MS)
  }
  throw browserAutomationError("browser_target_not_ready")
}

function requireSnapshotRef(target: ActiveBrowserAutomationTarget, ref: string) {
  const refs = snapshotRefs.get(targetKey(target))
  if (!refs) throw browserAutomationError("stale_snapshot_ref", { ref })
  const result = refs.get(ref)
  if (result && result.guestID === target.guest.id && result.url === target.guest.getURL()) return result
  throw browserAutomationError("stale_snapshot_ref", { ref })
}

function resolveElementSelector(
  target: ActiveBrowserAutomationTarget,
  ref: string | undefined,
  selector: string | undefined,
  action: string,
) {
  if (ref) return requireSnapshotRef(target, ref).selector
  if (selector) return selector
  throw new Error(`${action} requires ref or selector`)
}

function storeSnapshotRefs(target: ActiveBrowserAutomationTarget, elements: RawSnapshotElement[]) {
  snapshotRefs.set(
    targetKey(target),
    new Map(elements.map((item) => [item.ref, { selector: item.selector, guestID: target.guest.id, url: target.guest.getURL() }])),
  )
}

function clearSnapshotRefs(target: ActiveBrowserAutomationTarget) {
  snapshotRefs.delete(targetKey(target))
}

function clearSnapshotRefsForTab(tabID: string) {
  for (const key of snapshotRefs.keys()) {
    if (key.endsWith(`:${tabID}`)) snapshotRefs.delete(key)
  }
}

function serializeTarget(target: ActiveBrowserAutomationTarget): DesktopBrowserAutomationTarget {
  return {
    sourceWindowID: target.sourceWindowID,
    tabID: target.tabID,
    url: target.guest.getURL(),
    title: target.guest.getTitle(),
    sessionKey: target.sessionKey,
    sessionID: target.sessionID,
  }
}

function targetKey(target: {
  sourceWindowID: number
  tabID: string
}) {
  return `${target.sourceWindowID}:${target.tabID}`
}

function normalizeURL(input: string) {
  const url = new URL(input)
  if (!["http:", "https:", "file:"].includes(url.protocol)) {
    throw new Error(`Unsupported side browser URL: ${url.protocol}`)
  }
  return url.toString()
}

async function navigateTarget(target: ActiveBrowserAutomationTarget, sessionKey: string, url: string, tabID?: string) {
  if (target.guest.getURL() === url) return
  clearSnapshotRefs(target)

  for (let attempt = 0; attempt <= NAVIGATION_RETRY_DELAYS_MS.length; attempt++) {
    if (target.guest.isDestroyed() || getTargetForSession(sessionKey, tabID)?.tabID !== target.tabID) {
      throw browserAutomationError("browser_navigation_failed")
    }

    try {
      await target.guest.loadURL(url)
      if (target.guest.getURL() === url) return
    } catch {
      if (target.guest.isDestroyed()) throw browserAutomationError("browser_navigation_failed")
    }

    if (target.guest.getURL() === url) return
    const delayMs = NAVIGATION_RETRY_DELAYS_MS[attempt]
    if (delayMs === undefined) break
    await delay(delayMs)
  }

  throw browserAutomationError("browser_navigation_failed")
}

function nonPreemptiveBrowserInteractionError(action: "focus" | "hover" | "press_key") {
  return new AutomationHttpError(
    409,
    "browser_input_injection_disabled",
    `Browser ${action} is disabled because desktop automation does not inject mouse or keyboard input.`,
    {
      recovery: "Use semantic browser actions such as click, type, clear, select_option, scroll, upload_file, or navigation instead.",
    },
  )
}

async function executeJSON<T>(guest: WebContents, script: string, options?: { retryReadOnly?: boolean }) {
  const attempts = options?.retryReadOnly ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return (await guest.executeJavaScript(script, true)) as T
    } catch (error) {
      if (!isRendererLifecycleError(error)) throw error instanceof Error ? error : new Error(String(error))
      if (attempt + 1 >= attempts || guest.isDestroyed()) throw browserAutomationError("browser_renderer_unavailable")
      await delay(75)
    }
  }
  throw browserAutomationError("browser_renderer_unavailable")
}

function isRendererLifecycleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /render frame|render process|webcontents.*destroy|object has been destroyed|frame.*disposed|renderer.*gone/i.test(message)
}

async function runSelectorAction(guest: WebContents, selector: string, action: "click") {
  const result = await executeJSON<{ ok: boolean; error?: string }>(
    guest,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return { ok: false, error: "Element not found" }
      element.scrollIntoView({ block: "center", inline: "center" })
      element.click()
      return { ok: true }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? `Failed to ${action} browser element`)
}

async function runTypeAction(guest: WebContents, selector: string, text: string, submit: boolean) {
  const result = await executeJSON<{ ok: boolean; error?: string }>(
    guest,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return { ok: false, error: "Element not found" }
      const commit = () => {
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
      }
      element.scrollIntoView({ block: "center", inline: "center" })
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = ${JSON.stringify(text)}
        commit()
      } else if (element instanceof HTMLSelectElement) {
        const option = Array.from(element.options).find((item) => item.text === ${JSON.stringify(text)} || item.value === ${JSON.stringify(text)})
        if (!option) return { ok: false, error: "No matching option found" }
        element.value = option.value
        commit()
      } else if (element.isContentEditable) {
        element.textContent = ${JSON.stringify(text)}
        commit()
      } else {
        return { ok: false, error: "Element is not editable" }
      }
      if (${submit ? "true" : "false"}) {
        const form =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? element.form
            : element.closest("form")
        if (form instanceof HTMLFormElement && typeof form.requestSubmit === "function") {
          form.requestSubmit()
        } else {
          return { ok: false, error: "Semantic submit requires a form" }
        }
      }
      return { ok: true }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? "Failed to type into browser element")
}

async function runScrollAction(
  guest: WebContents,
  input: {
    selector?: string
    direction?: "up" | "down" | "left" | "right"
    amount?: number
  },
) {
  const result = await executeJSON<{ ok: boolean; error?: string }>(
    guest,
    `(() => {
      const selector = ${JSON.stringify(input.selector ?? "")}
      const direction = ${JSON.stringify(input.direction ?? "down")}
      const amount = ${JSON.stringify(input.amount ?? DEFAULT_SCROLL_AMOUNT)}
      if (selector) {
        const element = document.querySelector(selector)
        if (!(element instanceof Element)) return { ok: false, error: "Element not found" }
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" })
        } else {
          element.scrollIntoView({ block: "center", inline: "center" })
        }
        return { ok: true }
      }
      const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0
      const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0
      window.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" })
      return { ok: true }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? "Failed to scroll browser page")
}

async function runClearAction(guest: WebContents, selector: string) {
  const result = await executeJSON<{ ok: boolean; error?: string }>(
    guest,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return { ok: false, error: "Element not found" }
      const commit = () => {
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
      }
      element.scrollIntoView({ block: "center", inline: "center" })
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = ""
        commit()
        return { ok: true }
      }
      if (element instanceof HTMLSelectElement) {
        element.selectedIndex = -1
        commit()
        return { ok: true }
      }
      if (element.isContentEditable) {
        element.textContent = ""
        commit()
        return { ok: true }
      }
      return { ok: false, error: "Element is not clearable" }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? "Failed to clear browser element")
}

async function runSelectOptionAction(
  guest: WebContents,
  selector: string,
  input: {
    value?: string
    label?: string
    text?: string
  },
) {
  if (!input.value && !input.label && !input.text) {
    throw new Error("select_option requires value, label, or text")
  }
  const result = await executeJSON<{ ok: boolean; error?: string; selected?: string }>(
    guest,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLSelectElement)) return { ok: false, error: "Element is not a select" }
      element.scrollIntoView({ block: "center", inline: "center" })
      const value = ${JSON.stringify(input.value ?? "")}
      const label = ${JSON.stringify(input.label ?? "")}
      const text = ${JSON.stringify(input.text ?? "")}
      const option = Array.from(element.options).find((item) => {
        const content = (item.textContent ?? "").replace(/\\s+/g, " ").trim()
        return (value && item.value === value) || (label && item.label === label) || (text && content === text)
      })
      if (!option) return { ok: false, error: "No matching option found" }
      element.value = option.value
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true, selected: option.value }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? "Failed to select browser option")
}

async function runUploadFileAction(guest: WebContents, selector: string, files: string[]) {
  const debuggerController = ensureDebugger(guest)
  await debuggerController.attachIfNeeded()
  try {
    const document = await guest.debugger.sendCommand("DOM.getDocument", {})
    const node = await guest.debugger.sendCommand("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector,
    })
    if (typeof node.nodeId !== "number" || node.nodeId <= 0) {
      throw new Error(`Upload target was not found: ${selector}`)
    }
    const role = await executeJSON<{ ok: boolean; error?: string }>(
      guest,
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        if (!(element instanceof HTMLElement)) return { ok: false, error: "Element not found" }
        element.scrollIntoView({ block: "center", inline: "center" })
        if (!(element instanceof HTMLInputElement) || element.type !== "file") {
          return { ok: false, error: "Target element is not <input type=file>" }
        }
        return { ok: true }
      })()`,
      { retryReadOnly: true },
    )
    if (!role.ok) throw new Error(role.error ?? "Upload target is invalid")
    await guest.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: node.nodeId,
      files,
    })
  } finally {
    debuggerController.detachIfNeeded()
  }
}

async function waitForText(
  guest: WebContents,
  input: {
    text?: string
    textGone?: string
    timeoutMs?: number
  },
) {
  if (!input.text && !input.textGone) throw new Error("wait_for requires text or textGone")
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedAt = Date.now()
  let polls = 0
  while (Date.now() - startedAt < timeoutMs) {
    const matched = await executeJSON<boolean>(
      guest,
      `(() => {
        const text = (document.body?.innerText ?? "").replace(/\\s+/g, " ")
        const hasText = ${input.text ? `text.includes(${JSON.stringify(input.text)})` : "true"}
        const missingText = ${input.textGone ? `!text.includes(${JSON.stringify(input.textGone)})` : "true"}
        return hasText && missingText
      })()`,
      { retryReadOnly: true },
    )
    if (matched) return true
    await delay(pollDelay(polls++))
  }
  return false
}

async function waitForSelector(
  guest: WebContents,
  input: {
    selector: string
    visible?: boolean
    timeoutMs?: number
    stableMs?: number
  },
) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedAt = Date.now()
  const stableMs = input.stableMs ?? 0
  let polls = 0
  let stableStartedAt: number | undefined
  while (Date.now() - startedAt < timeoutMs) {
    const matched = await executeJSON<boolean>(
      guest,
      `(() => {
        const element = document.querySelector(${JSON.stringify(input.selector)})
        if (!(element instanceof Element)) return false
        if (!${input.visible === true ? "true" : "false"}) return true
        const rect = element.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return false
        const style = getComputedStyle(element)
        return style.display !== "none" && style.visibility !== "hidden"
      })()`,
      { retryReadOnly: true },
    )
    if (matched) {
      stableStartedAt = stableStartedAt ?? Date.now()
      if (Date.now() - stableStartedAt >= stableMs) return true
    } else {
      stableStartedAt = undefined
    }
    await delay(pollDelay(polls++))
  }
  return false
}

async function waitForUrl(
  guest: WebContents,
  input: {
    url: string
    match?: "equals" | "includes"
    timeoutMs?: number
    stableMs?: number
  },
) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedAt = Date.now()
  const stableMs = input.stableMs ?? 0
  let polls = 0
  let stableStartedAt: number | undefined
  while (Date.now() - startedAt < timeoutMs) {
    const current = guest.getURL()
    if (urlMatched(current, input.url, input.match)) {
      stableStartedAt = stableStartedAt ?? Date.now()
      if (Date.now() - stableStartedAt >= stableMs) return true
    } else {
      stableStartedAt = undefined
    }
    await delay(pollDelay(polls++))
  }
  return false
}

function urlMatched(current: string, expected: string, match: "equals" | "includes" | undefined) {
  if (match === "includes") return current.includes(expected)
  return current === expected
}

async function waitForLoadState(
  guest: WebContents,
  input: {
    state: "domcontentloaded" | "load" | "networkidle"
    timeoutMs?: number
    stableMs?: number
  },
) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const stableMs = input.stableMs ?? NETWORK_IDLE_STABLE_MS
  let polls = 0
  const startedAt = Date.now()
  let stableStartedAt: number | undefined
  while (Date.now() - startedAt < timeoutMs) {
    const readyState = await executeJSON<string>(guest, `document.readyState`, { retryReadOnly: true })
    if (input.state === "domcontentloaded" && (readyState === "interactive" || readyState === "complete")) return true
    if (input.state === "load" && readyState === "complete") return true
    if (input.state === "networkidle") {
      if (readyState === "complete" && !guest.isLoading()) {
        stableStartedAt = stableStartedAt ?? Date.now()
        if (Date.now() - stableStartedAt >= stableMs) return true
      } else {
        stableStartedAt = undefined
      }
    }
    await delay(pollDelay(polls++))
  }
  return false
}

async function waitForNavigation(
  guest: WebContents,
  input: {
    url?: string
    match?: "equals" | "includes"
    timeoutMs?: number
    stableMs?: number
  },
) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const stableMs = input.stableMs ?? NETWORK_IDLE_STABLE_MS
  const startedAt = Date.now()
  const initialUrl = guest.getURL()
  let sawActivity = false
  let polls = 0
  while (Date.now() - startedAt < timeoutMs) {
    const current = guest.getURL()
    const matchesExpected = input.url ? urlMatched(current, input.url, input.match) : false
    const loading = guest.isLoading()
    if (loading || current !== initialUrl) {
      sawActivity = true
    }
    if (matchesExpected && sawActivity) {
      const remaining = Math.max(250, timeoutMs - (Date.now() - startedAt))
      return waitForLoadState(guest, { state: "networkidle", timeoutMs: remaining, stableMs })
    }
    if (sawActivity && !loading) {
      const readyState = await executeJSON<string>(guest, `document.readyState`, { retryReadOnly: true })
      if (current !== initialUrl || readyState === "complete") return true
    }
    await delay(pollDelay(polls++))
  }
  return false
}

/** Wait until a history/reload action has produced a settled document. */
async function ensureNavigationSettled(guest: WebContents, initialUrl: string, reload = false) {
  const matched = await waitForNavigation(guest, {
    timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
    stableMs: reload ? 0 : NETWORK_IDLE_STABLE_MS,
  })
  if (matched) return
  // A reload keeps the same URL, so waitForNavigation cannot observe a URL
  // change. Check the load state once more before reporting a timeout.
  if (reload && guest.getURL() === initialUrl) {
    const loaded = await waitForLoadState(guest, {
      state: "load",
      timeoutMs: 250,
      stableMs: 0,
    })
    if (loaded) return
  }
  throw browserAutomationError("navigation_timeout")
}

function formatSnapshotText(elements: DesktopBrowserAutomationElement[]) {
  if (elements.length === 0) return "No interactive elements found on the current side browser page."
  return elements.map(formatSnapshotLine).join("\n")
}

function formatSnapshotLine(element: DesktopBrowserAutomationElement) {
  const status = [
    element.disabled ? "disabled" : "",
    element.checked ? "checked" : "",
    element.focused ? "focused" : "",
  ]
    .filter(Boolean)
    .join(", ")
  const detail = [
    element.role ? `role=${element.role}` : "",
    element.text ? `text=${JSON.stringify(element.text)}` : "",
    element.value ? `value=${JSON.stringify(element.value)}` : "",
    element.placeholder ? `placeholder=${JSON.stringify(element.placeholder)}` : "",
    element.href ? `href=${JSON.stringify(element.href)}` : "",
    status ? `[${status}]` : "",
  ]
    .filter(Boolean)
    .join(" ")
  return `${element.ref} <${element.tag}> ${detail}`.trim()
}

async function resolveDownloadRequest(
  target: ActiveBrowserAutomationTarget,
  input: {
    url?: string
    resourceID?: string
    ref?: string
    selector?: string
    cachePolicy?: DesktopBrowserAutomationCachePolicy
  },
) {
  if (input.url) {
    return {
      mode: "download" as const,
      resourceID: input.resourceID,
      url: input.url,
    }
  }

  const selector = input.ref ? requireSnapshotRef(target, input.ref).selector : input.selector
  const resources = await executeJSON<RawResource[]>(
    target.guest,
    buildExtractResourceScript({
      selector,
      limit: MEDIA_LIMIT,
    }),
    // Resource discovery is read-only. A guest renderer can briefly be
    // unavailable while a navigation commits, so use the same bounded
    // lifecycle recovery as extractResource/readPage instead of failing the
    // whole download request on the first transient renderer error.
    { retryReadOnly: true },
  )
  const enrichedResources = enrichResourcesWithNetwork(resources, listBrowserNetworkForSession(target.sessionKey ?? "", 200))
  const resource =
    (input.resourceID ? enrichedResources.find((item) => item.resourceID === input.resourceID) : undefined) ??
    enrichedResources.find((item) => item.downloadable) ??
    enrichedResources[0]
  if (!resource) {
    throw new Error("No matching browser resource was found to download")
  }

  const source =
    resource.sources?.find((item) => item.url && !item.url.startsWith("blob:") && !item.url.startsWith("data:")) ??
    resource.sources?.find((item) => !!item.url)
  if (source?.url) {
    if (source.url.startsWith("blob:")) {
      return {
        mode: "export" as const,
        exportKind: "blob" as const,
        resourceID: resource.resourceID,
        selector: resource.selector,
        url: source.url,
      }
    }
    if (source.url.startsWith("data:")) {
      return {
        mode: "export" as const,
        exportKind: "data" as const,
        resourceID: resource.resourceID,
        selector: resource.selector,
        url: source.url,
      }
    }
    return {
      mode: "download" as const,
      resourceID: resource.resourceID,
      url: source.url,
    }
  }

  if (resource.kind === "canvas") {
    return {
      mode: "export" as const,
      exportKind: "canvas" as const,
      resourceID: resource.resourceID,
      selector: resource.selector,
      url: `${target.guest.getURL()}#canvas`,
    }
  }

  throw new Error(resource.reason ?? "This browser resource does not expose a downloadable URL")
}

async function exportBrowserResource(
  target: ActiveBrowserAutomationTarget,
  input: {
    exportKind: "blob" | "data" | "canvas"
    resourceID?: string
    selector?: string
    url: string
  },
  preferredFilename: string | undefined,
): Promise<BrowserDownloadResult> {
  if (input.exportKind === "data") {
    const downloaded = await writeDataUrlDownload(input.url, preferredFilename, "browser-resource")
    return {
      ...downloaded,
      ok: true,
      cacheObserved: false,
      cacheHit: false,
      fallbackUsed: false,
      sourceKind: "data-export" as const,
      resolvedUrl: input.url,
    }
  }
  if (input.exportKind === "blob") {
    const dataUrl = await exportBlobAsDataUrl(target.guest, input.url)
    const downloaded = await writeDataUrlDownload(dataUrl, preferredFilename, "browser-resource")
    return {
      ...downloaded,
      ok: true,
      cacheObserved: false,
      cacheHit: false,
      fallbackUsed: false,
      sourceKind: "blob-export" as const,
      resolvedUrl: input.url,
    }
  }
  if (!input.selector) {
    throw new Error("Canvas export requires a selector")
  }
  const dataUrl = await exportCanvasAsDataUrl(target.guest, input.selector)
  const downloaded = await writeDataUrlDownload(dataUrl, preferredFilename, "browser-canvas")
  return {
    ...downloaded,
    ok: true,
    cacheObserved: false,
    cacheHit: false,
    fallbackUsed: false,
    sourceKind: "canvas-export" as const,
    resolvedUrl: input.url,
  }
}

async function exportBlobAsDataUrl(guest: WebContents, url: string) {
  return executeJSON<string>(
    guest,
    `fetch(${JSON.stringify(url)})
      .then((response) => {
        if (!response.ok) throw new Error("Blob fetch failed: " + response.status)
        return response.blob()
      })
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error("Blob read failed"))
        reader.onload = () => resolve(String(reader.result || ""))
        reader.readAsDataURL(blob)
      }))`,
    { retryReadOnly: true },
  )
}

async function exportCanvasAsDataUrl(guest: WebContents, selector: string) {
  return executeJSON<string>(
    guest,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLCanvasElement)) throw new Error("Canvas element not found")
      return element.toDataURL("image/png")
    })()`,
    { retryReadOnly: true },
  )
}

async function writeDataUrlDownload(dataUrl: string, preferredFilename: string | undefined, fallbackName: string) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) throw new Error("Invalid data URL")
  const mime = match[1] || "application/octet-stream"
  const isBase64 = !!match[2]
  const payload = match[3] || ""
  const bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8")
  const outputDir = join(app.getPath("userData"), "output", "browser-downloads")
  await mkdir(outputDir, { recursive: true })
  const ext = extensionForMime(mime)
  const filename = sanitizeForPath((preferredFilename?.trim() || fallbackName).replace(/\.[a-z0-9]+$/i, "")) + ext
  const path = join(outputDir, `${Date.now()}-${filename}`)
  await writeFile(path, bytes)
  return {
    path,
    filename,
    mime,
    bytes: bytes.byteLength,
  }
}

function extensionForMime(mime: string) {
  if (mime === "image/png") return ".png"
  if (mime === "image/jpeg") return ".jpg"
  if (mime === "image/webp") return ".webp"
  if (mime === "image/gif") return ".gif"
  if (mime === "image/svg+xml") return ".svg"
  if (mime === "video/mp4") return ".mp4"
  if (mime === "audio/mpeg") return ".mp3"
  if (mime === "application/json") return ".json"
  if (mime === "text/plain") return ".txt"
  return ""
}

function buildSnapshotScript(limit: number) {
  return `(() => {
    const collapse = (value) => (value ?? "").replace(/\\s+/g, " ").trim()
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      const style = getComputedStyle(element)
      return style.display !== "none" && style.visibility !== "hidden"
    }
    const selectorFor = (element) => {
      const parts = []
      let current = element
      while (current instanceof Element && current !== document.documentElement) {
        let part = current.localName
        if (!part) break
        if (current.id) {
          part += "#" + CSS.escape(current.id)
          parts.unshift(part)
          break
        }
        const parent = current.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.localName === current.localName)
          if (siblings.length > 1) {
            part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
          }
        }
        parts.unshift(part)
        current = current.parentElement
      }
      return parts.join(" > ")
    }
    const nodes = Array.from(
      document.querySelectorAll('a, button, input, textarea, select, summary, [role], [contenteditable=""], [contenteditable="true"], [tabindex]')
    )
      .filter(visible)
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false
        if (element.hasAttribute("tabindex")) return Number(element.getAttribute("tabindex")) >= 0
        return true
      })
      .slice(0, ${JSON.stringify(limit)})
      .map((element, index) => {
        const text = collapse(element.innerText || element.textContent || "")
        const value =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? collapse(element.value)
            : undefined
        return {
          ref: "e" + String(index + 1),
          selector: selectorFor(element),
          tag: element.localName,
          role: element.getAttribute("role") || undefined,
          text: text || undefined,
          placeholder:
            element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
              ? collapse(element.placeholder) || undefined
              : undefined,
          value: value || undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          disabled:
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? element.disabled
              : element.getAttribute("aria-disabled") === "true",
          checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true",
          focused: document.activeElement === element,
        }
      })
    return nodes
  })()`
}

function buildReadPageScript(input: {
  textLimit: number
  interactiveLimit: number
  headingLimit: number
  landmarkLimit: number
  mediaLimit: number
}) {
  return `(() => {
    const collapse = (value) => (value ?? "").replace(/\\s+/g, " ").trim()
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      const style = getComputedStyle(element)
      return style.display !== "none" && style.visibility !== "hidden"
    }
    const selectorFor = (element) => {
      const parts = []
      let current = element
      while (current instanceof Element && current !== document.documentElement) {
        let part = current.localName
        if (!part) break
        if (current.id) {
          part += "#" + CSS.escape(current.id)
          parts.unshift(part)
          break
        }
        const parent = current.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.localName === current.localName)
          if (siblings.length > 1) {
            part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
          }
        }
        parts.unshift(part)
        current = current.parentElement
      }
      return parts.join(" > ")
    }
    const mimeGuess = (url) => {
      const value = String(url || "").split(/[?#]/)[0].toLowerCase()
      if (value.endsWith(".png")) return "image/png"
      if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg"
      if (value.endsWith(".gif")) return "image/gif"
      if (value.endsWith(".webp")) return "image/webp"
      if (value.endsWith(".avif")) return "image/avif"
      if (value.endsWith(".svg")) return "image/svg+xml"
      if (value.endsWith(".mp4")) return "video/mp4"
      if (value.endsWith(".webm")) return "video/webm"
      if (value.endsWith(".mp3")) return "audio/mpeg"
      if (value.endsWith(".wav")) return "audio/wav"
      if (value.endsWith(".ogg")) return "audio/ogg"
      return undefined
    }
    const normalizeUrl = (url) => {
      const value = collapse(url)
      return value || undefined
    }
    const pushSource = (list, item) => {
      if (!item?.url) return
      if (list.some((entry) => entry.kind === item.kind && entry.url === item.url)) return
      list.push(item)
    }
    const parseSrcset = (srcset, kind) =>
      String(srcset || "")
        .split(",")
        .map((item) => collapse(item).split(/\\s+/)[0])
        .filter(Boolean)
        .map((url) => ({
          kind,
          url,
          mimeGuess: mimeGuess(url),
        }))
    const mediaHrefKind = (href) => {
      const value = String(href || "")
      if (/\\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)(\\?|#|$)/i.test(value)) return "image"
      if (/\\.(mp4|webm|mov|m4v)(\\?|#|$)/i.test(value)) return "video"
      if (/\\.(mp3|wav|ogg|m4a|aac|flac)(\\?|#|$)/i.test(value)) return "audio"
      return undefined
    }
    const resolveBackgroundSources = (element) => {
      if (!(element instanceof Element)) return []
      const raw = getComputedStyle(element).backgroundImage || ""
      const results = []
      const pushBackground = (url, label) => {
        const normalized = collapse(url)
        if (!normalized) return
        if (results.some((entry) => entry.url === normalized)) return
        results.push({
          kind: "background-image",
          url: normalized,
          mimeGuess: mimeGuess(normalized),
          label: label || undefined,
        })
      }
      Array.from(raw.matchAll(/image-set\\((.*?)\\)/g)).forEach((match) => {
        Array.from(match[1].matchAll(/url\\((['"]?)(.*?)\\1\\)\\s*([^,)]*)/g)).forEach((candidate) => {
          pushBackground(candidate[2], collapse(candidate[3]) || "image-set")
        })
      })
      Array.from(raw.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)).forEach((match) => {
        pushBackground(match[2])
      })
      return results
    }
    const resourceId = (kind, selector, key) => [kind, selector, key].filter(Boolean).join("::").slice(0, 400)
    const trackInfo = (track) => ({
      kind: track.kind || undefined,
      label: track.label || undefined,
      language: track.srclang || undefined,
      src: normalizeUrl(track.src),
      default: track.default || undefined,
    })
    const buildResource = (element, pageHint) => {
      const target =
        element instanceof HTMLPictureElement
          ? element.querySelector("img")
          : element instanceof Element
            ? element
            : null
      if (!(target instanceof Element)) return null
      const backgroundSources = resolveBackgroundSources(target)
      const backgroundImage = backgroundSources[0]?.url
      const hrefKind = target instanceof HTMLAnchorElement ? mediaHrefKind(target.href) : undefined
      const kind =
        target instanceof HTMLImageElement
          ? "image"
          : target instanceof HTMLVideoElement
            ? "video"
            : target instanceof HTMLAudioElement
              ? "audio"
              : target instanceof SVGElement
                ? "svg"
                : target instanceof HTMLCanvasElement
                  ? "canvas"
                  : hrefKind || (backgroundImage ? "image" : undefined)
      if (!kind) return null
      const rect = target.getBoundingClientRect()
      const sources = []
      const tracks =
        target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
          ? Array.from(target.querySelectorAll("track")).map(trackInfo)
          : []
      if (target instanceof HTMLImageElement) {
        pushSource(sources, { kind: "src", url: normalizeUrl(target.getAttribute("src")), mimeGuess: mimeGuess(target.getAttribute("src")) })
        pushSource(sources, { kind: "currentSrc", url: normalizeUrl(target.currentSrc), mimeGuess: mimeGuess(target.currentSrc) })
        parseSrcset(target.srcset, "srcset").forEach((item) => pushSource(sources, item))
        if (target.parentElement instanceof HTMLPictureElement) {
          Array.from(target.parentElement.querySelectorAll("source")).forEach((source) => {
            parseSrcset(source.srcset, "source").forEach((item) => pushSource(sources, item))
            pushSource(sources, { kind: "source", url: normalizeUrl(source.src), mimeGuess: mimeGuess(source.src) })
          })
        }
      }
      if (target instanceof HTMLVideoElement || target instanceof HTMLAudioElement) {
        pushSource(sources, { kind: "src", url: normalizeUrl(target.getAttribute("src")), mimeGuess: mimeGuess(target.getAttribute("src")) })
        pushSource(sources, { kind: "currentSrc", url: normalizeUrl(target.currentSrc), mimeGuess: mimeGuess(target.currentSrc) })
        Array.from(target.querySelectorAll("source")).forEach((source) => {
          pushSource(sources, {
            kind: "source",
            url: normalizeUrl(source.src),
            mimeGuess: source.type || mimeGuess(source.src),
            label: source.type || undefined,
          })
        })
        Array.from(target.querySelectorAll("track")).forEach((track) => {
          pushSource(sources, {
            kind: "track",
            url: normalizeUrl(track.src),
            mimeGuess: mimeGuess(track.src),
            label: collapse(track.label || track.srclang || track.kind || ""),
          })
        })
      }
      if (target instanceof HTMLVideoElement) {
        pushSource(sources, { kind: "poster", url: normalizeUrl(target.poster), mimeGuess: mimeGuess(target.poster) })
      }
      if (target instanceof HTMLAnchorElement) {
        pushSource(sources, { kind: "href", url: normalizeUrl(target.href), mimeGuess: mimeGuess(target.href) })
      }
      backgroundSources.forEach((item) => pushSource(sources, item))
      const downloadableSource = sources.find((item) => item.url && !item.url.startsWith("blob:") && !item.url.startsWith("data:"))
      const primaryUrl = downloadableSource?.url || sources[0]?.url || backgroundImage || undefined
      const reason =
        kind === "canvas"
          ? "Canvas pixels need capture or export."
          : sources.some((item) => item.url?.startsWith("blob:"))
            ? "Blob resource must be exported from the page context."
            : sources.some((item) => item.url?.startsWith("data:"))
              ? "Data URL resource should be exported instead of navigated."
              : !sources.length
                ? "No direct resource URL was found."
                : undefined
      return {
        kind,
        resourceID: resourceId(kind, selectorFor(target), primaryUrl || pageHint || target.localName),
        tagName: target.localName,
        selector: selectorFor(target),
        text: collapse(target instanceof HTMLElement ? target.innerText || target.textContent || "" : target.textContent || "") || undefined,
        alt: target instanceof HTMLImageElement ? collapse(target.alt) || undefined : undefined,
        title: target.getAttribute("title") || undefined,
        ariaLabel: target.getAttribute("aria-label") || undefined,
        src:
          target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? target.getAttribute("src") || undefined
            : undefined,
        currentSrc:
          target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? target.currentSrc || undefined
            : undefined,
        srcset: target instanceof HTMLImageElement ? target.srcset || undefined : undefined,
        poster: target instanceof HTMLVideoElement ? target.poster || undefined : undefined,
        width: Number.isFinite(rect.width) ? Math.round(rect.width) : undefined,
        height: Number.isFinite(rect.height) ? Math.round(rect.height) : undefined,
        naturalWidth: target instanceof HTMLImageElement ? target.naturalWidth || undefined : undefined,
        naturalHeight: target instanceof HTMLImageElement ? target.naturalHeight || undefined : undefined,
        duration:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? Number.isFinite(target.duration)
              ? target.duration
              : undefined
            : undefined,
        currentTime:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? Number.isFinite(target.currentTime)
              ? target.currentTime
              : undefined
            : undefined,
        paused:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.paused : undefined,
        controls:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.controls : undefined,
        muted:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.muted : undefined,
        loop:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.loop : undefined,
        autoplay:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.autoplay : undefined,
        backgroundImage: backgroundImage || undefined,
        pageHint,
        downloadable: !!downloadableSource,
        reason,
        sources,
        tracks: tracks.length ? tracks : undefined,
        visible: visible(target),
      }
    }
    const interactive = Array.from(
      document.querySelectorAll('a, button, input, textarea, select, summary, [role], [contenteditable=""], [contenteditable="true"], [tabindex]')
    )
      .filter(visible)
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false
        if (element.hasAttribute("tabindex")) return Number(element.getAttribute("tabindex")) >= 0
        return true
      })
      .slice(0, ${JSON.stringify(input.interactiveLimit)})
      .map((element, index) => {
        const text = collapse(element.innerText || element.textContent || "")
        const value =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? collapse(element.value)
            : undefined
        return {
          ref: "e" + String(index + 1),
          selector: selectorFor(element),
          tag: element.localName,
          role: element.getAttribute("role") || undefined,
          text: text || undefined,
          placeholder:
            element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
              ? collapse(element.placeholder) || undefined
              : undefined,
          value: value || undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          disabled:
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? element.disabled
              : element.getAttribute("aria-disabled") === "true",
          checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true",
          focused: document.activeElement === element,
        }
      })
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .filter(visible)
      .slice(0, ${JSON.stringify(input.headingLimit)})
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: collapse(element.textContent || "").slice(0, 280),
        selector: selectorFor(element),
      }))
      .filter((item) => item.text)
    const landmarks = Array.from(document.querySelectorAll("main, nav, header, footer, aside, form, [role]"))
      .filter(visible)
      .slice(0, ${JSON.stringify(input.landmarkLimit)})
      .map((element) => ({
        role: element.getAttribute("role") || element.localName,
        text: collapse(
          element instanceof HTMLElement ? element.innerText || element.getAttribute("aria-label") || element.textContent || "" : element.textContent || ""
        ).slice(0, 280) || undefined,
        selector: selectorFor(element),
      }))
    const mediaElements = Array.from(
      new Set(
        Array.from(document.querySelectorAll("img, picture, video, audio, svg, canvas, a[href]")).concat(
          Array.from(document.querySelectorAll("body *"))
            .filter((element) => visible(element) && resolveBackgroundSources(element).length > 0)
            .slice(0, ${JSON.stringify(input.mediaLimit)}),
        ),
      ),
    )
    const media = mediaElements
      .map((element) => buildResource(element, element instanceof Element && resolveBackgroundSources(element).length > 0 ? "background-image" : undefined))
      .concat(
        Array.from(document.querySelectorAll("link[rel~='icon'], meta[property='og:image'], meta[name='twitter:image']"))
          .map((element) => {
            const url =
              element instanceof HTMLLinkElement
                ? normalizeUrl(element.href)
                : normalizeUrl(element.getAttribute("content"))
            if (!url) return null
            const pageHint =
              element instanceof HTMLLinkElement
                ? "favicon"
                : element.getAttribute("property") === "og:image"
                  ? "og:image"
                  : "twitter:image"
            return {
              kind: "image",
              resourceID: resourceId("image", selectorFor(element), url),
              tagName: element.localName,
              selector: selectorFor(element),
              title: element.getAttribute("title") || undefined,
              src: url,
              currentSrc: url,
              pageHint,
              downloadable: !url.startsWith("blob:") && !url.startsWith("data:"),
              reason: url.startsWith("blob:") ? "Blob resource must be exported from the page context." : url.startsWith("data:") ? "Data URL resource should be exported instead of navigated." : undefined,
              sources: [{ kind: element instanceof HTMLLinkElement ? "favicon" : "meta", url, mimeGuess: mimeGuess(url) }],
              visible: false,
            }
          }),
      )
      .filter((item) => item && (item.visible || item.pageHint))
      .filter((item, index, list) => list.findIndex((entry) => entry.resourceID === item.resourceID) === index)
      .slice(0, ${JSON.stringify(input.mediaLimit)})
    return {
      title: document.title || "",
      url: location.href,
      readyState: document.readyState,
      text: collapse(document.body?.innerText || "").slice(0, ${JSON.stringify(input.textLimit)}),
      headings,
      landmarks,
      interactive,
      media,
    }
  })()`
}

function buildExtractResourceScript(input: {
  selector?: string
  limit: number
}) {
  return `(() => {
    const collapse = (value) => (value ?? "").replace(/\\s+/g, " ").trim()
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      const style = getComputedStyle(element)
      return style.display !== "none" && style.visibility !== "hidden"
    }
    const selectorFor = (element) => {
      const parts = []
      let current = element
      while (current instanceof Element && current !== document.documentElement) {
        let part = current.localName
        if (!part) break
        if (current.id) {
          part += "#" + CSS.escape(current.id)
          parts.unshift(part)
          break
        }
        const parent = current.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.localName === current.localName)
          if (siblings.length > 1) {
            part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
          }
        }
        parts.unshift(part)
        current = current.parentElement
      }
      return parts.join(" > ")
    }
    const mimeGuess = (url) => {
      const value = String(url || "").split(/[?#]/)[0].toLowerCase()
      if (value.endsWith(".png")) return "image/png"
      if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg"
      if (value.endsWith(".gif")) return "image/gif"
      if (value.endsWith(".webp")) return "image/webp"
      if (value.endsWith(".avif")) return "image/avif"
      if (value.endsWith(".svg")) return "image/svg+xml"
      if (value.endsWith(".mp4")) return "video/mp4"
      if (value.endsWith(".webm")) return "video/webm"
      if (value.endsWith(".mp3")) return "audio/mpeg"
      if (value.endsWith(".wav")) return "audio/wav"
      if (value.endsWith(".ogg")) return "audio/ogg"
      return undefined
    }
    const normalizeUrl = (url) => {
      const value = collapse(url)
      return value || undefined
    }
    const pushSource = (list, item) => {
      if (!item?.url) return
      if (list.some((entry) => entry.kind === item.kind && entry.url === item.url)) return
      list.push(item)
    }
    const parseSrcset = (srcset, kind) =>
      String(srcset || "")
        .split(",")
        .map((item) => collapse(item).split(/\\s+/)[0])
        .filter(Boolean)
        .map((url) => ({
          kind,
          url,
          mimeGuess: mimeGuess(url),
        }))
    const mediaHrefKind = (href) => {
      const value = String(href || "")
      if (/\\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)(\\?|#|$)/i.test(value)) return "image"
      if (/\\.(mp4|webm|mov|m4v)(\\?|#|$)/i.test(value)) return "video"
      if (/\\.(mp3|wav|ogg|m4a|aac|flac)(\\?|#|$)/i.test(value)) return "audio"
      return undefined
    }
    const resolveBackgroundSources = (element) => {
      if (!(element instanceof Element)) return []
      const raw = getComputedStyle(element).backgroundImage || ""
      const results = []
      const pushBackground = (url, label) => {
        const normalized = collapse(url)
        if (!normalized) return
        if (results.some((entry) => entry.url === normalized)) return
        results.push({
          kind: "background-image",
          url: normalized,
          mimeGuess: mimeGuess(normalized),
          label: label || undefined,
        })
      }
      Array.from(raw.matchAll(/image-set\\((.*?)\\)/g)).forEach((match) => {
        Array.from(match[1].matchAll(/url\\((['"]?)(.*?)\\1\\)\\s*([^,)]*)/g)).forEach((candidate) => {
          pushBackground(candidate[2], collapse(candidate[3]) || "image-set")
        })
      })
      Array.from(raw.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)).forEach((match) => {
        pushBackground(match[2])
      })
      return results
    }
    const resourceId = (kind, selector, key) => [kind, selector, key].filter(Boolean).join("::").slice(0, 400)
    const trackInfo = (track) => ({
      kind: track.kind || undefined,
      label: track.label || undefined,
      language: track.srclang || undefined,
      src: normalizeUrl(track.src),
      default: track.default || undefined,
    })
    const buildResource = (element, pageHint) => {
      const target =
        element instanceof HTMLPictureElement
          ? element.querySelector("img")
          : element instanceof Element
            ? element
            : null
      if (!(target instanceof Element)) return null
      const backgroundSources = resolveBackgroundSources(target)
      const backgroundImage = backgroundSources[0]?.url
      const hrefKind = target instanceof HTMLAnchorElement ? mediaHrefKind(target.href) : undefined
      const kind =
        target instanceof HTMLImageElement
          ? "image"
          : target instanceof HTMLVideoElement
            ? "video"
            : target instanceof HTMLAudioElement
              ? "audio"
              : target instanceof SVGElement
                ? "svg"
                : target instanceof HTMLCanvasElement
                  ? "canvas"
                  : hrefKind || (backgroundImage ? "image" : undefined)
      if (!kind) return null
      const rect = target.getBoundingClientRect()
      const sources = []
      const tracks =
        target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
          ? Array.from(target.querySelectorAll("track")).map(trackInfo)
          : []
      if (target instanceof HTMLImageElement) {
        pushSource(sources, { kind: "src", url: normalizeUrl(target.getAttribute("src")), mimeGuess: mimeGuess(target.getAttribute("src")) })
        pushSource(sources, { kind: "currentSrc", url: normalizeUrl(target.currentSrc), mimeGuess: mimeGuess(target.currentSrc) })
        parseSrcset(target.srcset, "srcset").forEach((item) => pushSource(sources, item))
        if (target.parentElement instanceof HTMLPictureElement) {
          Array.from(target.parentElement.querySelectorAll("source")).forEach((source) => {
            parseSrcset(source.srcset, "source").forEach((item) => pushSource(sources, item))
            pushSource(sources, { kind: "source", url: normalizeUrl(source.src), mimeGuess: mimeGuess(source.src) })
          })
        }
      }
      if (target instanceof HTMLVideoElement || target instanceof HTMLAudioElement) {
        pushSource(sources, { kind: "src", url: normalizeUrl(target.getAttribute("src")), mimeGuess: mimeGuess(target.getAttribute("src")) })
        pushSource(sources, { kind: "currentSrc", url: normalizeUrl(target.currentSrc), mimeGuess: mimeGuess(target.currentSrc) })
        Array.from(target.querySelectorAll("source")).forEach((source) => {
          pushSource(sources, {
            kind: "source",
            url: normalizeUrl(source.src),
            mimeGuess: source.type || mimeGuess(source.src),
            label: source.type || undefined,
          })
        })
        Array.from(target.querySelectorAll("track")).forEach((track) => {
          pushSource(sources, {
            kind: "track",
            url: normalizeUrl(track.src),
            mimeGuess: mimeGuess(track.src),
            label: collapse(track.label || track.srclang || track.kind || ""),
          })
        })
      }
      if (target instanceof HTMLVideoElement) {
        pushSource(sources, { kind: "poster", url: normalizeUrl(target.poster), mimeGuess: mimeGuess(target.poster) })
      }
      if (target instanceof HTMLAnchorElement) {
        pushSource(sources, { kind: "href", url: normalizeUrl(target.href), mimeGuess: mimeGuess(target.href) })
      }
      backgroundSources.forEach((item) => pushSource(sources, item))
      const downloadableSource = sources.find((item) => item.url && !item.url.startsWith("blob:") && !item.url.startsWith("data:"))
      const primaryUrl = downloadableSource?.url || sources[0]?.url || backgroundImage || undefined
      const reason =
        kind === "canvas"
          ? "Canvas pixels need capture or export."
          : sources.some((item) => item.url?.startsWith("blob:"))
            ? "Blob resource must be exported from the page context."
            : sources.some((item) => item.url?.startsWith("data:"))
              ? "Data URL resource should be exported instead of navigated."
              : !sources.length
                ? "No direct resource URL was found."
                : undefined
      return {
        kind,
        resourceID: resourceId(kind, selectorFor(target), primaryUrl || pageHint || target.localName),
        tagName: target.localName,
        selector: selectorFor(target),
        text: collapse(target instanceof HTMLElement ? target.innerText || target.textContent || "" : target.textContent || "") || undefined,
        alt: target instanceof HTMLImageElement ? collapse(target.alt) || undefined : undefined,
        title: target.getAttribute("title") || undefined,
        ariaLabel: target.getAttribute("aria-label") || undefined,
        src:
          target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? target.getAttribute("src") || undefined
            : undefined,
        currentSrc:
          target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? target.currentSrc || undefined
            : undefined,
        srcset: target instanceof HTMLImageElement ? target.srcset || undefined : undefined,
        poster: target instanceof HTMLVideoElement ? target.poster || undefined : undefined,
        href: target instanceof HTMLAnchorElement ? target.href : undefined,
        download: target instanceof HTMLAnchorElement ? target.getAttribute("download") || undefined : undefined,
        width: Number.isFinite(rect.width) ? Math.round(rect.width) : undefined,
        height: Number.isFinite(rect.height) ? Math.round(rect.height) : undefined,
        naturalWidth: target instanceof HTMLImageElement ? target.naturalWidth || undefined : undefined,
        naturalHeight: target instanceof HTMLImageElement ? target.naturalHeight || undefined : undefined,
        duration:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? Number.isFinite(target.duration)
              ? target.duration
              : undefined
            : undefined,
        currentTime:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement
            ? Number.isFinite(target.currentTime)
              ? target.currentTime
              : undefined
            : undefined,
        paused:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.paused : undefined,
        controls:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.controls : undefined,
        muted:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.muted : undefined,
        loop:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.loop : undefined,
        autoplay:
          target instanceof HTMLVideoElement || target instanceof HTMLAudioElement ? target.autoplay : undefined,
        backgroundImage: backgroundImage || undefined,
        pageHint,
        downloadable: !!downloadableSource,
        reason,
        sources,
        tracks: tracks.length ? tracks : undefined,
        visible: visible(target),
      }
    }
    if (${input.selector ? "true" : "false"}) {
      const selected = document.querySelector(${JSON.stringify(input.selector ?? "")})
      if (!selected) throw new Error("Target resource element was not found")
      const resource = buildResource(selected, selected instanceof Element && resolveBackgroundSources(selected).length > 0 ? "background-image" : undefined)
      if (!resource) return []
      return [resource]
    }
    const mediaElements = Array.from(
      new Set(
        Array.from(document.querySelectorAll("img, picture, video, audio, svg, canvas, a[href]")).concat(
          Array.from(document.querySelectorAll("body *"))
            .filter((element) => visible(element) && resolveBackgroundSources(element).length > 0)
            .slice(0, ${JSON.stringify(input.limit)}),
        ),
      ),
    )
    return mediaElements
      .map((element) => buildResource(element, element instanceof Element && resolveBackgroundSources(element).length > 0 ? "background-image" : undefined))
      .concat(
        Array.from(document.querySelectorAll("link[rel~='icon'], meta[property='og:image'], meta[name='twitter:image']"))
          .map((element) => {
            const url =
              element instanceof HTMLLinkElement
                ? normalizeUrl(element.href)
                : normalizeUrl(element.getAttribute("content"))
            if (!url) return null
            const pageHint =
              element instanceof HTMLLinkElement
                ? "favicon"
                : element.getAttribute("property") === "og:image"
                  ? "og:image"
                  : "twitter:image"
            return {
              kind: "image",
              resourceID: resourceId("image", selectorFor(element), url),
              tagName: element.localName,
              selector: selectorFor(element),
              src: url,
              currentSrc: url,
              pageHint,
              downloadable: !url.startsWith("blob:") && !url.startsWith("data:"),
              reason: url.startsWith("blob:") ? "Blob resource must be exported from the page context." : url.startsWith("data:") ? "Data URL resource should be exported instead of navigated." : undefined,
              sources: [{ kind: element instanceof HTMLLinkElement ? "favicon" : "meta", url, mimeGuess: mimeGuess(url) }],
              visible: false,
            }
          }),
      )
      .filter((item) => item && (item.visible || item.pageHint))
      .filter((item, index, list) => list.findIndex((entry) => entry.resourceID === item.resourceID) === index)
      .slice(0, ${JSON.stringify(input.limit)})
  })()`
}

function buildCaptureElementRectScript(selector: string) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof Element)) throw new Error("Element not found")
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "center", inline: "center" })
    }
    const rect = element.getBoundingClientRect()
    return {
      selector: ${JSON.stringify(selector)},
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(0, Math.ceil(rect.width)),
      height: Math.max(0, Math.ceil(rect.height)),
    }
  })()`
}

function enrichResourcesWithNetwork<T extends DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource>(
  resources: T[],
  networkEntries: BrowserNetworkEntry[],
) {
  return resources.map((resource) => enrichResourceWithNetwork(resource, networkEntries))
}

function enrichResourceWithNetwork<T extends DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource>(
  resource: T,
  networkEntries: BrowserNetworkEntry[],
) {
  const currentSources = resource.sources ?? []
  const sources = currentSources.map((source) => enrichSourceWithNetwork(source, networkEntries))
  const inferred = inferNetworkSourcesForResource(resource, networkEntries, sources)
  const nextSources = mergeResourceSources(inferred.length > 0 ? [...sources, ...inferred] : sources)
  const nextDownloadable =
    resource.downloadable ||
    nextSources.some((source) => source.url && !source.url.startsWith("blob:") && !source.url.startsWith("data:"))
  const nextReason = nextDownloadable && !resource.downloadable
    ? "Recovered a downloadable candidate from recent browser network activity."
    : resource.reason
  const primarySource = pickPrimaryResourceSource(nextSources)
  const limitation = classifyResourceLimitation(resource, nextSources, networkEntries, nextDownloadable)
  const recommendation = recommendResourceAction(resource, nextSources, limitation, nextDownloadable)
  if (
    nextSources.length === currentSources.length &&
    nextSources.every((source, index) => source === currentSources[index]) &&
    nextDownloadable === resource.downloadable &&
    nextReason === resource.reason &&
    primarySource === resource.primarySource &&
    limitation === resource.limitation &&
    recommendation.action === resource.recommendedAction &&
    recommendation.reason === resource.recommendedReason
  ) {
    return resource
  }
  return {
    ...resource,
    downloadable: nextDownloadable,
    reason: nextReason,
    limitation,
    recommendedAction: recommendation.action,
    recommendedReason: recommendation.reason,
    primarySource,
    sources: nextSources,
  }
}

function mergeResourceSources(sources: DesktopBrowserAutomationResourceSource[]) {
  const merged = new Map<string, DesktopBrowserAutomationResourceSource>()
  for (const source of sources) {
    if (!source.url) continue
    const comparable = normalizeComparableUrl(source.url)
    const current = merged.get(comparable)
    if (!current) {
      merged.set(comparable, source)
      continue
    }
    merged.set(comparable, {
      ...current,
      kind: pickSourceKind(current, source),
      label: current.label ?? source.label,
      mimeGuess: current.mimeGuess ?? source.mimeGuess,
      mimeType: current.mimeType ?? source.mimeType,
      statusCode: current.statusCode ?? source.statusCode,
      contentDisposition: current.contentDisposition ?? source.contentDisposition,
      requested: current.requested || source.requested || undefined,
    })
  }
  return [...merged.values()]
}

function pickSourceKind(left: DesktopBrowserAutomationResourceSource, right: DesktopBrowserAutomationResourceSource) {
  return sourcePriority(right) > sourcePriority(left) ? right.kind : left.kind
}

function sourcePriority(source: DesktopBrowserAutomationResourceSource) {
  if (source.kind === "currentSrc") return 7
  if (source.kind === "network") return 6
  if (source.kind === "poster") return 5
  if (source.kind === "src") return 4
  if (source.kind === "source") return 3
  if (source.kind === "srcset") return 2
  return 1
}

function pickPrimaryResourceSource(sources: DesktopBrowserAutomationResourceSource[]) {
  return [...sources]
    .sort((left, right) => primarySourcePriority(right) - primarySourcePriority(left))
    .at(0)
}

function primarySourcePriority(source: DesktopBrowserAutomationResourceSource) {
  const direct = !source.url.startsWith("blob:") && !source.url.startsWith("data:")
  const requested = source.requested ? 10 : 0
  const directWeight = direct ? 100 : 0
  return directWeight + requested + sourcePriority(source)
}

function classifyResourceLimitation(
  resource: DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource,
  sources: DesktopBrowserAutomationResourceSource[],
  networkEntries: BrowserNetworkEntry[],
  downloadable: boolean,
): DesktopBrowserAutomationResourceLimitation | undefined {
  if (downloadable) return undefined
  if (resource.kind === "canvas") return "canvas-export-required"
  if (sources.some((item) => item.url.startsWith("blob:"))) return "blob"
  if (sources.some((item) => item.url.startsWith("data:"))) return "data"
  if (sources.some((item) => item.statusCode === 401 || item.statusCode === 403)) return "cross-origin-restricted"
  if ((resource.kind === "video" || resource.kind === "audio") && networkEntries.some((entry) => isNetworkCandidateForResource(entry, resource))) {
    return "mse"
  }
  return "not-found-in-network"
}

function recommendResourceAction(
  resource: DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource,
  sources: DesktopBrowserAutomationResourceSource[],
  limitation: DesktopBrowserAutomationResourceLimitation | undefined,
  downloadable: boolean,
) {
  if (downloadable) {
    return {
      action: "browser_download_resource" as const,
      reason: "A direct downloadable source is available.",
    }
  }
  if (limitation === "blob" || limitation === "data" || limitation === "canvas-export-required") {
    return {
      action: "browser_download_resource" as const,
      reason: "This resource should be exported through browser_download_resource instead of navigating to its raw URL.",
    }
  }
  if (limitation === "cross-origin-restricted") {
    return {
      action: "browser_capture_element" as const,
      reason: "The page appears to expose the media visually but not as a directly downloadable browser resource.",
    }
  }
  if (limitation === "mse") {
    return {
      action: "browser_get_network" as const,
      reason: "This looks like a streamed media resource; inspect recent network activity or capture the visible player frame.",
    }
  }
  if (!resource.visible) {
    return {
      action: "browser_scroll" as const,
      reason: "The resource is not currently visible; scroll it into view and extract again.",
    }
  }
  if (sources.length === 0) {
    return {
      action: "browser_wait_for_load_state" as const,
      reason: "No resource URL is visible yet; wait for the page to settle, then retry extraction.",
    }
  }
  return {
    action: "browser_capture_element" as const,
    reason: "No reliable downloadable URL was found; capture the visible element instead.",
  }
}

function enrichSourceWithNetwork(source: DesktopBrowserAutomationResourceSource, networkEntries: BrowserNetworkEntry[]) {
  if (!source.url || source.url.startsWith("blob:") || source.url.startsWith("data:")) return source
  const match = findMatchingNetworkEntry(source.url, networkEntries)
  if (!match) return source
  return {
    ...source,
    requested: true,
    mimeType: source.mimeType ?? match.mimeType,
    mimeGuess: source.mimeGuess ?? normalizeMimeType(match.mimeType),
    statusCode: source.statusCode ?? match.statusCode,
    contentDisposition: source.contentDisposition ?? match.contentDisposition,
  }
}

function findMatchingNetworkEntry(url: string, networkEntries: BrowserNetworkEntry[]) {
  const normalized = normalizeComparableUrl(url)
  return networkEntries
    .toReversed()
    .find((entry) => normalizeComparableUrl(entry.url) === normalized)
}

function normalizeComparableUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return url
  }
}

function normalizeMimeType(value: string | undefined) {
  if (!value) return undefined
  return value.split(";")[0]?.trim() || undefined
}

function inferNetworkSourcesForResource(
  resource: DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource,
  networkEntries: BrowserNetworkEntry[],
  existingSources: DesktopBrowserAutomationResourceSource[],
) {
  const existing = new Set(existingSources.map((source) => normalizeComparableUrl(source.url)))
  const directDownloadable = existingSources.some((source) => source.url && !source.url.startsWith("blob:") && !source.url.startsWith("data:"))
  if (directDownloadable) return []
  if (resource.kind === "canvas" || resource.kind === "svg") return []
  return networkEntries
    .toReversed()
    .filter((entry) => isNetworkCandidateForResource(entry, resource))
    .filter((entry) => !existing.has(normalizeComparableUrl(entry.url)))
    .slice(0, 3)
    .map((entry) => ({
      kind: "network" as const,
      url: entry.url,
      mimeGuess: normalizeMimeType(entry.mimeType) ?? mimeGuessFromNetworkUrl(entry.url),
      mimeType: entry.mimeType,
      statusCode: entry.statusCode,
      contentDisposition: entry.contentDisposition,
      requested: true,
      label: "network-inferred",
    }))
}

function isNetworkCandidateForResource(
  entry: BrowserNetworkEntry,
  resource: DesktopBrowserAutomationPageMedia | DesktopBrowserAutomationResource,
) {
  if (!entry.url || entry.error) return false
  if (entry.statusCode && entry.statusCode >= 400) return false
  const mime = normalizeMimeType(entry.mimeType)
  if (resource.kind === "image") {
    return mime?.startsWith("image/") || entry.resourceType === "image" || hasImageLikeExtension(entry.url)
  }
  if (resource.kind === "video") {
    return (
      mime?.startsWith("video/") ||
      mime === "application/vnd.apple.mpegurl" ||
      mime === "application/x-mpegurl" ||
      entry.resourceType === "media" ||
      hasVideoLikeExtension(entry.url)
    )
  }
  if (resource.kind === "audio") {
    return mime?.startsWith("audio/") || entry.resourceType === "media" || hasAudioLikeExtension(entry.url)
  }
  return false
}

function hasImageLikeExtension(url: string) {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(url)
}

function hasVideoLikeExtension(url: string) {
  return /\.(mp4|webm|mov|m4v|m3u8|mpd)(\?|#|$)/i.test(url)
}

function hasAudioLikeExtension(url: string) {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(url)
}

function mimeGuessFromNetworkUrl(url: string) {
  const value = url.split(/[?#]/)[0].toLowerCase()
  if (value.endsWith(".png")) return "image/png"
  if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg"
  if (value.endsWith(".gif")) return "image/gif"
  if (value.endsWith(".webp")) return "image/webp"
  if (value.endsWith(".avif")) return "image/avif"
  if (value.endsWith(".svg")) return "image/svg+xml"
  if (value.endsWith(".mp4")) return "video/mp4"
  if (value.endsWith(".webm")) return "video/webm"
  if (value.endsWith(".mov")) return "video/quicktime"
  if (value.endsWith(".m3u8")) return "application/vnd.apple.mpegurl"
  if (value.endsWith(".mpd")) return "application/dash+xml"
  if (value.endsWith(".mp3")) return "audio/mpeg"
  if (value.endsWith(".wav")) return "audio/wav"
  if (value.endsWith(".ogg")) return "audio/ogg"
  if (value.endsWith(".m4a")) return "audio/mp4"
  return undefined
}

async function downloadBrowserResource(
  target: ActiveBrowserAutomationTarget,
  url: string,
  preferredFilename: string | undefined,
  cachePolicy: DesktopBrowserAutomationCachePolicy,
): Promise<BrowserDownloadResult> {
  const cacheable = isCacheableBrowserResourceUrl(url)
  const cached = cacheable ? findBrowserCachedResourceByUrl(url) : undefined
  const cacheObserved = !!cached
  if (cachePolicy === "cache-only") {
    if (!cacheObserved) {
      return {
        ok: false,
        cacheObserved: false,
        cacheHit: false,
        fallbackUsed: false,
        sourceKind: "cache-miss" as const,
        missReason: "cache-miss" as const,
        resolvedUrl: url,
      }
    }
    const cachedDownload = await downloadBrowserResourceViaSessionFetch(target, url, preferredFilename, "force-cache").catch(() => undefined)
    if (!cachedDownload) {
      return {
        ok: false,
        cacheObserved: true,
        cacheHit: false,
        fallbackUsed: false,
        sourceKind: "cache-miss" as const,
        missReason: "cache-miss" as const,
        resolvedUrl: url,
      }
    }
    return {
      ...cachedDownload,
      ok: true,
      cacheObserved: true,
      cacheHit: true,
      fallbackUsed: false,
      sourceKind: "cache" as const,
    }
  }

  if (cachePolicy === "prefer-cache" && cacheObserved) {
    const cachedDownload = await downloadBrowserResourceViaSessionFetch(target, url, preferredFilename, "force-cache").catch(() => undefined)
    if (cachedDownload) {
      return {
        ...cachedDownload,
        ok: true,
        cacheObserved: true,
        cacheHit: true,
        fallbackUsed: false,
        sourceKind: "cache" as const,
      }
    }
  }

  if (cachePolicy === "bypass-cache" && cacheable) {
    const bypassed = await downloadBrowserResourceViaSessionFetch(target, url, preferredFilename, "reload").catch(() => undefined)
    if (bypassed) {
      return {
        ...bypassed,
        ok: true,
        cacheObserved,
        cacheHit: false,
        fallbackUsed: false,
        sourceKind: "network" as const,
      }
    }
  }

  const downloaded = await downloadBrowserResourceViaNavigation(target, url, preferredFilename)
  return {
    ...downloaded,
    ok: true,
    cacheObserved,
    cacheHit: false,
    fallbackUsed: cachePolicy === "prefer-cache" && cacheObserved,
    sourceKind: "network" as const,
    resolvedUrl: url,
  }
}

async function downloadBrowserResourceViaNavigation(target: ActiveBrowserAutomationTarget, url: string, preferredFilename: string | undefined) {
  const outputDir = join(app.getPath("userData"), "output", "browser-downloads")
  await mkdir(outputDir, { recursive: true })
  return new Promise<{
    path: string
    filename: string
    mime?: string
    bytes?: number
    resolvedUrl?: string
  }>((resolve, reject) => {
    const session = target.guest.session
    let settled = false
    const cleanup = () => {
      session.removeListener("will-download", onWillDownload)
      clearTimeout(timeout)
    }
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onWillDownload = (_event: Event, item: DownloadItem) => {
      if (item.getURL() !== url) return
      const filename = sanitizeForPath(preferredFilename?.trim() || item.getFilename() || "download")
      const path = join(outputDir, `${Date.now()}-${filename}`)
      item.setSavePath(path)
      item.once("done", (_itemEvent, state) => {
        if (state !== "completed") {
          settle(() => reject(new Error(`Download did not complete: ${state}`)))
          return
        }
        settle(() =>
          resolve({
            path,
            filename: item.getFilename() || filename,
            mime: item.getMimeType() || undefined,
            bytes: item.getReceivedBytes(),
            resolvedUrl: item.getURL() || url,
          }),
        )
      })
    }
    const timeout = setTimeout(() => {
      settle(() => reject(new Error(`Timed out downloading browser resource: ${url}`)))
    }, DOWNLOAD_TIMEOUT_MS)
    session.on("will-download", onWillDownload)
    try {
      target.guest.downloadURL(url)
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}

async function downloadBrowserResourceViaSessionFetch(
  target: ActiveBrowserAutomationTarget,
  url: string,
  preferredFilename: string | undefined,
  cacheMode: "force-cache" | "reload",
) {
  const response = await target.guest.session.fetch(url, {
    cache: cacheMode,
  })
  if (!response.ok) {
    throw new Error(`Browser session fetch failed: ${response.status} ${response.statusText}`)
  }
  const mime = normalizeMimeType(response.headers.get("content-type") ?? undefined) ?? "application/octet-stream"
  const bytes = Buffer.from(await response.arrayBuffer())
  const outputDir = join(app.getPath("userData"), "output", "browser-downloads")
  await mkdir(outputDir, { recursive: true })
  const filename = resolveSessionFetchFilename(preferredFilename, response.url || url, response.headers.get("content-disposition") ?? undefined, mime)
  const path = join(outputDir, `${Date.now()}-${filename}`)
  await writeFile(path, bytes)
  return {
    path,
    filename,
    mime,
    bytes: bytes.byteLength,
    resolvedUrl: response.url || url,
  }
}

function isCacheableBrowserResourceUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://")
}

function resolveSessionFetchFilename(
  preferredFilename: string | undefined,
  url: string,
  contentDisposition: string | undefined,
  mime: string,
) {
  const direct = preferredFilename?.trim()
  if (direct) return sanitizeOutputFilename(direct, mime)
  const dispositionName = parseContentDispositionFilename(contentDisposition)
  if (dispositionName) return sanitizeOutputFilename(dispositionName, mime)
  const urlName = parseFilenameFromUrl(url)
  if (urlName) return sanitizeOutputFilename(urlName, mime)
  return sanitizeOutputFilename("download", mime)
}

function parseContentDispositionFilename(value: string | undefined) {
  if (!value) return
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  return /filename=\"?([^\";]+)\"?/i.exec(value)?.[1]
}

function parseFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url)
    const raw = parsed.pathname.split("/").filter(Boolean).at(-1)
    if (!raw) return
    return decodeURIComponent(raw)
  } catch {
    return
  }
}

function sanitizeOutputFilename(value: string, mime: string) {
  const trimmed = value.trim()
  const ext = /\.[a-z0-9]+$/i.test(trimmed) ? "" : extensionForMime(mime)
  const safe = trimmed.replace(/[<>:\"/\\\\|?*\x00-\x1f]/g, "_")
  return (safe || "download") + ext
}

function sanitizeForPath(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

async function captureGuestPage(guest: WebContents, rect?: Electron.Rectangle) {
  let lastError: unknown
  for (let attempt = 0; attempt < CAPTURE_RETRY_LIMIT; attempt += 1) {
    try {
      return await guest.capturePage(rect)
    } catch (error) {
      lastError = error
      if (!isRetryableCaptureError(error) || attempt === CAPTURE_RETRY_LIMIT - 1) break
      await delay(CAPTURE_RETRY_DELAY_MS)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isRetryableCaptureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UnknownVizError")
}

async function resolveUploadFiles(sessionKey: string, inputs: string[]) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("upload_file requires at least one file path")
  }
  const directory = decodeSessionDirectory(sessionKey)
  const allowedRoots = [
    directory,
    join(app.getPath("userData"), "output"),
  ].filter(Boolean)

  const files = await Promise.all(
    inputs.map(async (input) => {
      const next = isAbsolute(input) ? resolve(input) : resolve(directory, input)
      const info = await stat(next).catch(() => undefined)
      if (!info) throw new Error(`Upload file was not found: ${input}`)
      if (!info.isFile()) throw new Error(`Upload target is not a file: ${input}`)
      if (!allowedRoots.some((root) => containsPath(root, next))) {
        throw new Error(`Upload file is outside the allowed workspace paths: ${input}`)
      }
      return next
    }),
  )

  return Array.from(new Set(files))
}

function decodeSessionDirectory(sessionKey: string) {
  const split = sessionKey.lastIndexOf("/")
  const encoded = split > 0 ? sessionKey.slice(0, split) : sessionKey
  if (!encoded) throw new Error(`Invalid browser session key: ${sessionKey}`)
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, "base64").toString("utf8")
}

function containsPath(root: string, target: string) {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function ensureDebugger(guest: WebContents) {
  const attached = guest.debugger.isAttached()
  return {
    async attachIfNeeded() {
      if (attached) return
      guest.debugger.attach("1.3")
    },
    detachIfNeeded() {
      if (attached || !guest.debugger.isAttached()) return
      guest.debugger.detach()
    },
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pollDelay(attempt: number) {
  return Math.min(WAIT_POLL_MAX_MS, WAIT_POLL_MS + attempt * 20)
}
