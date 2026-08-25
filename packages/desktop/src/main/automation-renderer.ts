import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app, BrowserWindow } from "electron"

export type DesktopAutomationWindow = {
  id: number
  title: string
  url: string
  focused: boolean
  visible: boolean
  minimized: boolean
  destroyed: boolean
  detached: boolean
  bounds: Electron.Rectangle
}

export type AutomationDomSnapshotInput = {
  selector?: string
  region?: string
  offset?: number
  limit?: number
}

export type AutomationDomAction =
  | "click"
  | "setText"
  | "appendText"
  | "toggle"
  | "setChecked"
  | "setExpanded"
  | "setSelected"
  | "select"
  | "scroll"

export type AutomationDomActionInput = {
  action: AutomationDomAction
  ref?: string
  fingerprint?: string
  snapshotID?: string
  selector?: string
  text?: string
  value?: string
  checked?: boolean
  expanded?: boolean
  selected?: boolean
  top?: number
  left?: number
  deltaX?: number
  deltaY?: number
}

export class AutomationDomError extends Error {
  constructor(
    readonly code: "stale_dom_snapshot" | "stale_dom_ref",
    message: string,
  ) {
    super(message)
    this.name = "AutomationDomError"
  }
}

export function listAutomationWindows() {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map(serializeWindow)
}

export function getAutomationWindow(windowID?: number) {
  if (windowID !== undefined) {
    const exact = BrowserWindow.fromId(windowID)
    if (exact && !exact.isDestroyed()) return exact
    return undefined
  }
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  return BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !isDetachedWindow(item))
}

export function serializeWindow(win: BrowserWindow): DesktopAutomationWindow {
  return {
    id: win.id,
    title: safe(() => win.getTitle()) ?? "",
    url: safe(() => win.webContents.getURL()) ?? "",
    focused: safe(() => win.isFocused()) ?? false,
    visible: safe(() => win.isVisible()) ?? false,
    minimized: safe(() => win.isMinimized()) ?? false,
    destroyed: win.isDestroyed(),
    detached: isDetachedWindow(win),
    bounds: safe(() => win.getBounds()) ?? { x: 0, y: 0, width: 0, height: 0 },
  }
}

export async function readRendererAutomationState(win: BrowserWindow) {
  return win.webContents.executeJavaScript(
    `(() => {
      const bridge = window.__LFCODE__?.automation
      if (!bridge?.getState) return null
      return bridge.getState()
    })()`,
    true,
  )
}

export async function callRendererAutomation<T>(win: BrowserWindow, action: string, input?: unknown) {
  return win.webContents.executeJavaScript(
    `(() => {
      const bridge = window.__LFCODE__?.automation
      if (!bridge?.call) throw new Error("Renderer automation bridge is not ready")
      const sanitize = (value) => {
        if (value === undefined) return null
        return JSON.parse(JSON.stringify(value))
      }
      return Promise.resolve(bridge.call(${JSON.stringify(action)}, ${JSON.stringify(input ?? null)})).then(sanitize)
    })()`,
    true,
  ) as Promise<T>
}

export async function snapshotAutomationDom(win: BrowserWindow, input?: string | AutomationDomSnapshotInput) {
  return runDomAutomation(
    win,
    "snapshot",
    typeof input === "string" ? { selector: input } : input ?? {},
  )
}

export async function queryAutomationDom(win: BrowserWindow, selector: string) {
  return runDomAutomation(win, "query", { selector })
}

export async function clickAutomationDom(win: BrowserWindow, selector: string) {
  return actAutomationDom(win, { action: "click", selector })
}

export async function typeAutomationDom(win: BrowserWindow, selector: string, text: string, append = false) {
  return actAutomationDom(win, { action: append ? "appendText" : "setText", selector, text })
}

export async function actAutomationDom(
  win: BrowserWindow,
  input: AutomationDomActionInput,
) {
  return runDomAutomation(win, "act", input)
}

export async function scrollAutomationDom(win: BrowserWindow, input: { selector?: string; top?: number; left?: number }) {
  return actAutomationDom(win, { action: "scroll", ...input })
}

export async function waitForAutomationDom(
  win: BrowserWindow,
  input: {
    ref?: string
    fingerprint?: string
    selector?: string
    visible?: boolean
    text?: string
    attribute?: { name: string; value?: string }
    disabled?: boolean
    checked?: boolean
    selected?: boolean
    timeoutMs?: number
    intervalMs?: number
  },
) {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 10_000, 0), 30_000)
  const intervalMs = Math.min(Math.max(input.intervalMs ?? 100, 25), 1_000)
  const startedAt = Date.now()
  while (true) {
    const result = await runDomAutomation<{ matched: boolean }>(win, "wait", input)
    if (result.matched || Date.now() - startedAt >= timeoutMs) {
      return { ...result, timedOut: !result.matched }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export async function captureAutomationWindow(win: BrowserWindow, label = "window") {
  const image = await win.webContents.capturePage()
  const outputDir = join(app.getPath("userData"), "output", "automation")
  await mkdir(outputDir, { recursive: true })
  const filename = `${label}-${Date.now()}-${win.id}.png`
  const path = join(outputDir, filename)
  await writeFile(path, image.toPNG())
  return path
}

function isDetachedWindow(win: BrowserWindow) {
  return safe(() => win.webContents.getURL())?.includes("detachedWindowID=") ?? false
}

function safe<T>(fn: () => T) {
  try {
    return fn()
  } catch {
    return undefined
  }
}

function runDomAutomation<T = unknown>(win: BrowserWindow, action: string, input: Record<string, unknown>) {
  return win.webContents
    .executeJavaScript(
      `(() => {
        const action = ${JSON.stringify(action)}
        const input = ${JSON.stringify(input)}
        const refAttribute = "data-lfcode-automation-ref"
        const fingerprintAttribute = "data-lfcode-automation-fingerprint"
        const interactiveSelector = "[data-automation-id], button, input, textarea, select, a, summary, [role=button], [role=tab], [role=checkbox], [role=switch], [contenteditable=true], [contenteditable=''], [tabindex]"
        const defaultSnapshotLimit = 300
        const maximumSnapshotLimit = 500
        const collapse = (value) => String(value ?? "").replace(/\\s+/g, " ").trim()
        const staleSnapshot = () => {
          throw new Error("LFCODE_DOM_SNAPSHOT_STALE: The DOM changed after this snapshot; take a fresh DOM snapshot.")
        }
        const staleRef = () => {
          throw new Error("LFCODE_DOM_REF_STALE: Automation ref is stale; take a fresh DOM snapshot.")
        }
        const newDocumentEpoch = () => {
          if (window.crypto && typeof window.crypto.getRandomValues === "function") {
            const values = new Uint32Array(2)
            window.crypto.getRandomValues(values)
            return Array.from(values, (value) => value.toString(36)).join("")
          }
          return Date.now().toString(36) + Math.random().toString(36).slice(2)
        }
        const automationState = () => {
          const existing = window.__lfcodeDesktopAutomationRefs
          const state = existing && typeof existing === "object" ? existing : {}
          if (typeof state.nextRef !== "number") state.nextRef = typeof state.next === "number" ? state.next : 0
          if (typeof state.nextSnapshot !== "number") state.nextSnapshot = 0
          if (typeof state.revision !== "number") state.revision = 0
          if (typeof state.documentEpoch !== "string") state.documentEpoch = newDocumentEpoch()
          if (!state.snapshots || typeof state.snapshots !== "object") state.snapshots = Object.create(null)
          if (!state.observer && typeof MutationObserver === "function" && document.documentElement) {
            state.observer = new MutationObserver((records) => {
              if (
                records.some(
                  (record) =>
                    record.type !== "attributes" ||
                    (record.attributeName !== refAttribute && record.attributeName !== fingerprintAttribute),
                )
              ) {
                state.revision += 1
              }
            })
            state.observer.observe(document.documentElement, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
            })
          }
          window.__lfcodeDesktopAutomationRefs = state
          return state
        }
        const state = automationState()
        const selectorInput = (value, fallback = "body") => {
          const selector = typeof value === "string" ? value : fallback
          if (!selector || selector.length > 512) throw new Error("Selector is invalid")
          return selector
        }
        const select = (selector = selectorInput(input.selector)) => {
          const element = document.querySelector(selector)
          if (!(element instanceof Element)) throw new Error("Target element was not found")
          return element
        }
        const snapshotRoot = () =>
          select(selectorInput(typeof input.region === "string" ? input.region : input.selector))
        const snapshotItemSelector = () =>
          typeof input.region === "string" && typeof input.selector === "string"
            ? selectorInput(input.selector)
            : interactiveSelector
        const visible = (element) => {
          if (!(element instanceof Element)) return false
          const style = getComputedStyle(element)
          return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden"
        }
        const fingerprint = (element) => {
          const parts = []
          let current = element
          let depth = 0
          while (current instanceof Element && current !== document.documentElement && depth < 6) {
            const parent = current.parentElement
            const ordinal = parent ? Array.from(parent.children).filter((item) => item.localName === current.localName).indexOf(current) : 0
            const identity =
              current.getAttribute("data-automation-id") ||
              current.id ||
              current.getAttribute("name") ||
              current.getAttribute("aria-label") ||
              current.getAttribute("role") ||
              ""
            parts.unshift(current.localName + ":" + identity.slice(0, 80) + ":" + String(ordinal))
            current = parent
            depth += 1
          }
          return parts.join("/")
        }
        const ensureRef = (element) => {
          const nextFingerprint = fingerprint(element)
          const existing = element.getAttribute(refAttribute)
          if (existing && element.getAttribute(fingerprintAttribute) === nextFingerprint) return { ref: existing, fingerprint: nextFingerprint }
          state.nextRef += 1
          const ref = "r" + state.nextRef.toString(36)
          element.setAttribute(refAttribute, ref)
          element.setAttribute(fingerprintAttribute, nextFingerprint)
          return { ref, fingerprint: nextFingerprint }
        }
        const resolveRef = () => {
          if (typeof input.ref !== "string" || !/^r[a-z0-9]+$/i.test(input.ref)) throw new Error("Automation ref is invalid")
          const element = document.querySelector("[" + refAttribute + "='" + input.ref + "']")
          if (!(element instanceof Element)) staleRef()
          const actual = fingerprint(element)
          if (element.getAttribute(fingerprintAttribute) !== actual || (typeof input.fingerprint === "string" && input.fingerprint !== actual)) {
            staleRef()
          }
          return element
        }
        const validateSnapshot = (element) => {
          if (typeof input.snapshotID !== "string") return
          const snapshot = state.snapshots[input.snapshotID]
          if (!snapshot || snapshot.revision !== state.revision) staleSnapshot()
          if (typeof input.ref === "string" && snapshot.refs[input.ref] !== fingerprint(element)) staleSnapshot()
        }
        const target = () => {
          const element = typeof input.ref === "string" ? resolveRef() : select()
          validateSnapshot(element)
          return element
        }
        const isFormControl = (element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        const valueOf = (element) => {
          if (element instanceof HTMLInputElement && element.type === "password") return undefined
          if (isFormControl(element)) return element.value.slice(0, 1000)
          if (element instanceof HTMLElement && element.isContentEditable) return collapse(element.textContent).slice(0, 1000)
          return undefined
        }
        const checkedOf = (element) =>
          element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true"
        const expandedOf = (element) =>
          element instanceof HTMLDetailsElement ? element.open : element.getAttribute("aria-expanded") === "true"
        const selectedOf = (element) =>
          element instanceof HTMLOptionElement ? element.selected : element.getAttribute("aria-selected") === "true"
        const node = (element, parentRef, snapshot) => {
          const identity = ensureRef(element)
          if (snapshot) snapshot.refs[identity.ref] = identity.fingerprint
          const rect = element.getBoundingClientRect()
          return {
            ...identity,
            ...(parentRef ? { parentRef } : {}),
            tag: element.tagName.toLowerCase(),
            id: element.id || undefined,
            role: element.getAttribute("role") || undefined,
            automationID: element.getAttribute("data-automation-id") || undefined,
            name: element.getAttribute("aria-label") || element.getAttribute("name") || undefined,
            text: (isFormControl(element) || (element instanceof HTMLElement && element.isContentEditable) ? "" : collapse(element.innerText || element.textContent).slice(0, 1000)) || undefined,
            value: valueOf(element),
            disabled:
              element instanceof HTMLButtonElement || isFormControl(element)
                ? element.disabled
                : element.getAttribute("aria-disabled") === "true",
            checked: checkedOf(element),
            expanded: expandedOf(element),
            selected: selectedOf(element),
            editable: isFormControl(element) || (element instanceof HTMLElement && element.isContentEditable),
            visible: visible(element),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          }
        }
        const setText = (element, value, append) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const next = append ? element.value + value : value
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set
            setter?.call(element, next)
          } else if (element instanceof HTMLElement && element.isContentEditable) {
            element.textContent = append ? String(element.textContent ?? "") + value : value
          } else {
            throw new Error("Target is not editable")
          }
          element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
          element.dispatchEvent(new Event("change", { bubbles: true }))
        }
        const requireBoolean = (key) => {
          if (typeof input[key] === "boolean") return input[key]
          throw new Error("Missing boolean " + key)
        }
        const setTargetState = (element, kind, value) => {
          const current = kind === "checked" ? checkedOf(element) : kind === "expanded" ? expandedOf(element) : selectedOf(element)
          if (current === value) return false
          if (kind === "checked" && element instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set
            setter?.call(element, value)
            element.dispatchEvent(new Event("input", { bubbles: true }))
            element.dispatchEvent(new Event("change", { bubbles: true }))
            return true
          }
          if (kind === "expanded" && element instanceof HTMLDetailsElement) {
            element.open = value
            element.dispatchEvent(new Event("toggle", { bubbles: true }))
            return true
          }
          if (kind === "selected" && element instanceof HTMLOptionElement) {
            element.selected = value
            const select = element.closest("select")
            if (select) {
              select.dispatchEvent(new Event("input", { bubbles: true }))
              select.dispatchEvent(new Event("change", { bubbles: true }))
            }
            return true
          }
          if (!(element instanceof HTMLElement)) throw new Error("Target cannot change the requested state")
          element.click()
          const next = kind === "checked" ? checkedOf(element) : kind === "expanded" ? expandedOf(element) : selectedOf(element)
          if (next !== value) throw new Error("Target did not reach the requested state")
          return true
        }
        const completedAction = (result) => {
          state.revision += 1
          return { ...result, revision: state.revision }
        }
        if (action === "snapshot") {
          const root = snapshotRoot()
          const offset = Number.isInteger(input.offset) && input.offset >= 0 ? input.offset : 0
          const limit = Math.min(Math.max(Number.isInteger(input.limit) && input.limit > 0 ? input.limit : defaultSnapshotLimit, 1), maximumSnapshotLimit)
          state.nextSnapshot += 1
          const snapshotID = "s" + state.documentEpoch + "-" + state.nextSnapshot.toString(36)
          const snapshot = { revision: state.revision, refs: Object.create(null) }
          state.snapshots[snapshotID] = snapshot
          const snapshotIDs = Object.keys(state.snapshots)
          if (snapshotIDs.length > 24) snapshotIDs.slice(0, snapshotIDs.length - 24).forEach((snapshotID) => delete state.snapshots[snapshotID])
          const rootNode = node(root, undefined, snapshot)
          const matches = Array.from(root.querySelectorAll(snapshotItemSelector())).filter((element) => element instanceof Element)
          const children = matches.slice(offset, offset + limit).map((element) => node(element, rootNode.ref, snapshot))
          const nextOffset = offset + children.length
          return {
            snapshotID,
            revision: snapshot.revision,
            region: typeof input.region === "string" ? input.region : typeof input.selector === "string" ? input.selector : "body",
            offset,
            limit,
            total: matches.length,
            ...(nextOffset < matches.length ? { nextOffset } : {}),
            root: rootNode,
            children,
            nodes: [rootNode, ...children],
          }
        }
        if (action === "query") return node(select())
        if (action === "act") {
          const element = target()
          const requested = String(input.action ?? "")
          if (requested === "click") {
            if (!(element instanceof HTMLElement)) throw new Error("Target cannot be clicked")
            element.click()
            return completedAction({ action: requested, node: node(element) })
          }
          if (requested === "setText" || requested === "appendText") {
            setText(element, String(input.text ?? ""), requested === "appendText")
            return completedAction({ action: requested, node: node(element) })
          }
          if (requested === "toggle") {
            if (!(element instanceof HTMLElement)) throw new Error("Target cannot be toggled")
            element.click()
            return completedAction({ action: requested, node: node(element) })
          }
          if (requested === "setChecked" || requested === "setExpanded" || requested === "setSelected") {
            const key = requested === "setChecked" ? "checked" : requested === "setExpanded" ? "expanded" : "selected"
            const value = requireBoolean(key)
            const changed = setTargetState(element, key, value)
            return completedAction({ action: requested, changed, target: value, node: node(element) })
          }
          if (requested === "select") {
            if (!(element instanceof HTMLSelectElement)) throw new Error("Target is not a select")
            const requestedValue = String(input.value ?? input.text ?? "")
            const option = Array.from(element.options).find((item) => item.value === requestedValue || collapse(item.text) === requestedValue)
            if (!option) throw new Error("Select option was not found")
            const changed = element.value !== option.value
            if (changed) {
              element.value = option.value
              element.dispatchEvent(new InputEvent("input", { bubbles: true }))
              element.dispatchEvent(new Event("change", { bubbles: true }))
            }
            return completedAction({ action: requested, changed, node: node(element), selected: option.value })
          }
          if (requested === "scroll") {
            const scrollTarget = element instanceof HTMLElement ? element : document.scrollingElement || document.documentElement
            const top = typeof input.top === "number" ? input.top : scrollTarget.scrollTop + Number(input.deltaY ?? 0)
            const left = typeof input.left === "number" ? input.left : scrollTarget.scrollLeft + Number(input.deltaX ?? 0)
            scrollTarget.scrollTo({ top, left, behavior: "auto" })
            return completedAction({ action: requested, node: node(element), top: scrollTarget.scrollTop, left: scrollTarget.scrollLeft, height: scrollTarget.scrollHeight, width: scrollTarget.scrollWidth })
          }
          throw new Error("Unsupported semantic DOM action")
        }
        if (action === "wait") {
          try {
            const element = target()
            const targetNode = node(element)
            const attribute = input.attribute && typeof input.attribute === "object" ? input.attribute : undefined
            const attributeMatches =
              !attribute ||
              (typeof attribute.name === "string" &&
                (typeof attribute.value === "string"
                  ? element.getAttribute(attribute.name) === attribute.value
                  : element.hasAttribute(attribute.name)))
            const matches =
              (input.visible === undefined || targetNode.visible === input.visible) &&
              (typeof input.text !== "string" || collapse(element.textContent).includes(input.text)) &&
              attributeMatches &&
              (input.disabled === undefined || targetNode.disabled === input.disabled) &&
              (input.checked === undefined || targetNode.checked === input.checked) &&
              (input.selected === undefined || targetNode.selected === input.selected)
            return { matched: matches, node: targetNode }
          } catch (error) {
            return { matched: false, error: error instanceof Error ? error.message : "Target is unavailable" }
          }
        }
        throw new Error("Unsupported DOM automation action")
      })()`,
      true,
    )
    .catch((error: unknown) => {
      const message =
        error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : String(error).replace(/^Error:\\s*/, "")
      if (message.startsWith("LFCODE_DOM_SNAPSHOT_STALE:")) {
        throw new AutomationDomError("stale_dom_snapshot", message.slice("LFCODE_DOM_SNAPSHOT_STALE:".length).trim())
      }
      if (message.startsWith("LFCODE_DOM_REF_STALE:")) {
        throw new AutomationDomError("stale_dom_ref", message.slice("LFCODE_DOM_REF_STALE:".length).trim())
      }
      throw error
    }) as Promise<T>
}
