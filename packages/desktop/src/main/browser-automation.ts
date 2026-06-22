import { BrowserWindow, type WebContents } from "electron"
import {
  registerDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationElement,
  type DesktopBrowserAutomationSnapshot,
  type DesktopBrowserAutomationTarget,
} from "@lfcode-ai/shared/desktop-browser-automation"
import { getActiveBrowserTarget, listActiveBrowserTargets } from "./browser-runtime"

const SNAPSHOT_LIMIT = 200
const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const WAIT_POLL_MS = 200
const OPEN_BROWSER_TARGET_TIMEOUT_MS = 10_000

type ActiveBrowserAutomationTarget = {
  sourceWindowID: number
  tabID: string
  guest: WebContents
}

type SnapshotRef = {
  selector: string
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

const snapshotRefs = new Map<string, Map<string, SnapshotRef>>()

export function registerBrowserAutomationBridge() {
  registerDesktopBrowserAutomationBridge({
    getActiveTarget: () => {
      const target = getPreferredTarget()
      if (!target) return
      return serializeTarget(target)
    },
    navigate: async (input) => {
      const url = normalizeURL(input.url)
      const target = (await ensurePreferredTarget(url)) ?? requirePreferredTarget()
      if (target.guest.getURL() !== url) {
        await target.guest.loadURL(url)
      }
      return serializeTarget(target)
    },
    snapshot: async () => {
      const target = requirePreferredTarget()
      const elements = await executeJSON<RawSnapshotElement[]>(target.guest, buildSnapshotScript(SNAPSHOT_LIMIT))
      snapshotRefs.set(targetKey(target), new Map(elements.map((item) => [item.ref, { selector: item.selector }])))
      return {
        target: serializeTarget(target),
        elements,
        text: formatSnapshotText(elements),
      } satisfies DesktopBrowserAutomationSnapshot
    },
    click: async (input) => {
      const target = requirePreferredTarget()
      const ref = requireSnapshotRef(target, input.ref)
      await runSelectorAction(target.guest, ref.selector, "click")
      return serializeTarget(target)
    },
    type: async (input) => {
      const target = requirePreferredTarget()
      const ref = requireSnapshotRef(target, input.ref)
      await runTypeAction(target.guest, ref.selector, input.text, input.submit === true)
      return serializeTarget(target)
    },
    pressKey: async (input) => {
      const target = requirePreferredTarget()
      sendKey(target.guest, input.key)
      return serializeTarget(target)
    },
    waitFor: async (input) => {
      const target = requirePreferredTarget()
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
  } satisfies DesktopBrowserAutomationBridge)
}

export function getActiveBrowserAutomationTarget(input?: {
  sourceWindowID?: number
}) {
  const target =
    input?.sourceWindowID !== undefined
      ? getTargetForWindow(input.sourceWindowID)
      : getPreferredTarget()
  if (!target) return
  return serializeTarget(target)
}

function getPreferredTarget() {
  const focusedWindowID = BrowserWindow.getFocusedWindow()?.id
  if (focusedWindowID !== undefined) {
    const focused = getTargetForWindow(focusedWindowID)
    if (focused) return focused
  }
  return listActiveBrowserTargets().at(0)
}

function requirePreferredTarget() {
  const target = getPreferredTarget()
  if (target) return target
  throw new Error("No active side browser tab")
}

async function ensurePreferredTarget(url: string) {
  const existing = getPreferredTarget()
  if (existing) return existing

  const win = getBrowserOpenWindow()
  if (!win) return

  win.webContents.send("browser-window-open", url)
  return waitForTarget(win.id, OPEN_BROWSER_TARGET_TIMEOUT_MS)
}

function getTargetForWindow(sourceWindowID: number) {
  return getActiveBrowserTarget({ sourceWindowID })
}

function getBrowserOpenWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && !isDetachedSidePanelWindow(focused)) return focused

  const windows = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed())
  const primary = windows.find((item) => !isDetachedSidePanelWindow(item))
  if (primary) return primary
  return focused ?? windows[0]
}

function isDetachedSidePanelWindow(win: BrowserWindow) {
  return win.webContents.getURL().includes("detachedWindowID=")
}

async function waitForTarget(sourceWindowID: number, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const target = getTargetForWindow(sourceWindowID)
    if (target) return target
    await delay(100)
  }
  throw new Error("Timed out waiting for the side browser tab to open")
}

function requireSnapshotRef(target: ActiveBrowserAutomationTarget, ref: string) {
  const refs = snapshotRefs.get(targetKey(target))
  if (!refs) throw new Error("No browser snapshot is available for the active side browser tab")
  const result = refs.get(ref)
  if (result) return result
  throw new Error(`Snapshot element ${ref} was not found; take a fresh browser snapshot first`)
}

function serializeTarget(target: ActiveBrowserAutomationTarget): DesktopBrowserAutomationTarget {
  return {
    sourceWindowID: target.sourceWindowID,
    tabID: target.tabID,
    url: target.guest.getURL(),
    title: target.guest.getTitle(),
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

async function executeJSON<T>(guest: WebContents, script: string) {
  return guest.executeJavaScript(script, true) as Promise<T>
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
      element.focus()
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
          element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
          element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }))
        }
      }
      return { ok: true }
    })()`,
  )
  if (result.ok) return
  throw new Error(result.error ?? "Failed to type into browser element")
}

function sendKey(guest: WebContents, key: string) {
  guest.focus()
  guest.sendInputEvent({
    type: "keyDown",
    keyCode: key,
  })
  if (key.length === 1) {
    guest.sendInputEvent({
      type: "char",
      keyCode: key,
    })
  }
  guest.sendInputEvent({
    type: "keyUp",
    keyCode: key,
  })
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
  while (Date.now() - startedAt < timeoutMs) {
    const matched = await executeJSON<boolean>(
      guest,
      `(() => {
        const text = (document.body?.innerText ?? "").replace(/\\s+/g, " ")
        const hasText = ${input.text ? `text.includes(${JSON.stringify(input.text)})` : "true"}
        const missingText = ${input.textGone ? `!text.includes(${JSON.stringify(input.textGone)})` : "true"}
        return hasText && missingText
      })()`,
    )
    if (matched) return true
    await delay(WAIT_POLL_MS)
  }
  return false
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
