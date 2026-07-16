import { ipcRenderer } from "electron"
import type {
  BrowserAutofillCandidate,
  BrowserAutofillMatch,
  BrowserPasswordCapturePayload,
} from "@lfcode-ai/shared/desktop-browser-management"

const BROWSER_REFERENCE_CHANNEL = "lfcode-browser-reference"

type BrowserReferenceCandidate = {
  label: string
  text: string
  url: string
  title?: string
  selector: string
  mode: "selection" | "element"
}

type SelectionSnapshot = {
  document: Document
  selection: Selection
}

const BROWSER_REFERENCE_ATTRIBUTE = "data-lfcode-browser-reference"

function editableInput(input: Element): input is HTMLInputElement {
  return input instanceof HTMLInputElement && !input.disabled && !input.readOnly
}

function passwordField() {
  return Array.from(document.querySelectorAll("input")).find((input) => editableInput(input) && input.type === "password")
}

function usernameField(currentPassword: HTMLInputElement) {
  const inputs = Array.from(document.querySelectorAll("input")).filter(editableInput)
  const currentIndex = inputs.indexOf(currentPassword)
  const before = currentIndex === -1 ? inputs : inputs.slice(0, currentIndex).reverse()
  return before.find((input) => {
    if (input === currentPassword) return false
    const type = input.type || "text"
    if (["email", "text", "search", "tel", "url"].includes(type)) return true
    const autocomplete = input.autocomplete?.toLowerCase() ?? ""
    return ["username", "email", "current-username"].some((value) => autocomplete.includes(value))
  })
}

function setInputValue(input: HTMLInputElement | undefined, value: string) {
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function bindAutofillPicker() {
  let picker: HTMLElement | undefined
  let request = 0

  const close = () => {
    request += 1
    picker?.remove()
    picker = undefined
  }

  const show = async (password: HTMLInputElement) => {
    close()
    if (location.origin === "null") return
    const currentRequest = request
    const origin = location.origin
    const candidates = await ipcRenderer
      .invoke("browser-list-autofill-candidates", origin)
      .catch(() => [] as BrowserAutofillCandidate[])
    if (currentRequest !== request || origin !== location.origin || !password.isConnected || candidates.length === 0) return

    const host = document.createElement("div")
    host.setAttribute("data-lfcode-autofill-picker", "")
    const shadow = host.attachShadow({ mode: "closed" })
    const panel = document.createElement("div")
    const title = document.createElement("div")
    title.textContent = `Fill a saved login for ${origin}`
    panel.append(title)

    for (const candidate of candidates) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = candidate.username || "Saved account"
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted || origin !== location.origin || !password.isConnected) return
        button.disabled = true
        const match = await ipcRenderer
          .invoke("browser-request-autofill", { id: candidate.id, origin })
          .catch(() => null as BrowserAutofillMatch | null)
        if (!match || origin !== location.origin || !password.isConnected) {
          close()
          return
        }
        setInputValue(usernameField(password), match.username)
        setInputValue(password, match.password)
        close()
      })
      panel.append(button)
    }

    const dismiss = document.createElement("button")
    dismiss.type = "button"
    dismiss.textContent = "Not now"
    dismiss.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      close()
    })
    panel.append(dismiss)

    const rect = password.getBoundingClientRect()
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      `left:${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`,
      `top:${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 180))}px`,
      "z-index:2147483647",
    ].join(";")
    const style = document.createElement("style")
    style.textContent = `
      div { box-sizing: border-box; width: 320px; padding: 10px; border: 1px solid #d0d5dd; border-radius: 10px; background: #fff; color: #101828; box-shadow: 0 12px 32px rgba(16,24,40,.2); font: 13px/1.4 system-ui, sans-serif; }
      div > div { width: auto; padding: 0 2px 8px; border: 0; border-radius: 0; box-shadow: none; font-weight: 600; }
      button { display: block; width: 100%; margin-top: 4px; padding: 7px 9px; border: 0; border-radius: 7px; background: #f2f4f7; color: #101828; text-align: left; font: inherit; cursor: pointer; }
      button:hover, button:focus-visible { background: #e4e7ec; outline: 2px solid #84adff; }
      button:last-child { color: #475467; background: transparent; }
    `
    shadow.append(style, panel)
    document.documentElement.append(host)
    picker = host
  }

  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target === picker) return
      const target = event.target
      if (!(target instanceof HTMLInputElement) || !editableInput(target) || target.type !== "password") {
        close()
        return
      }
      void show(target)
    },
    true,
  )
  window.addEventListener("pagehide", close)
}

function bindPasswordCapture() {
  document.addEventListener(
    "submit",
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return
      const password = passwordField()
      if (!password || !event.target.contains(password)) return
      if (!password.value) return
      const payload = {
        origin: location.origin,
        username: usernameField(password)?.value?.trim() ?? "",
        password: password.value,
      } satisfies BrowserPasswordCapturePayload
      ipcRenderer.send("browser-password-capture", payload)
    },
    true,
  )
}

function normalizeReferenceText(value: string | undefined | null) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 1200)
}

function selectorFor(node: Node | null | undefined) {
  const element = node instanceof Element ? node : node?.parentElement
  if (!element) return ""
  if (element.id) return `#${element.id}`

  const parts: string[] = []
  let current: Element | null = element
  while (current && parts.length < 5) {
    const tag = current.tagName.toLowerCase()
    const cls =
      typeof current.className === "string"
        ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
        : ""
    parts.unshift(cls ? `${tag}.${cls}` : tag)
    current = current.parentElement
  }

  return parts.join(" > ")
}

function elementPayload(node: Node | null | undefined, mode: BrowserReferenceCandidate["mode"], fallbackText?: string) {
  const target = node instanceof Element ? node : node?.parentElement
  if (!target) return
  const text = normalizeReferenceText(fallbackText ?? (target instanceof HTMLElement ? target.innerText : undefined) ?? target.textContent)
  if (!text) return
  return {
    label: document.title || location.hostname || location.href,
    text,
    url: location.href,
    title: document.title || undefined,
    selector: selectorFor(target),
    mode,
  } satisfies BrowserReferenceCandidate
}

function sameOriginDocuments(root: Document) {
  const docs = [root]
  const frames = Array.from(root.querySelectorAll("iframe, frame"))
  for (const frame of frames) {
    try {
      const child = (frame as HTMLIFrameElement | HTMLFrameElement).contentDocument
      if (child) docs.push(...sameOriginDocuments(child))
    } catch {}
  }
  return docs
}

function activeDocument(root: Document) {
  const element = root.activeElement
  if (!element) return root
  try {
    if (element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement) {
      return element.contentDocument ?? root
    }
  } catch {}
  return element.ownerDocument ?? root
}

function selectionFromDocument(doc: Document | undefined | null) {
  try {
    const selection = doc?.defaultView?.getSelection?.() ?? doc?.getSelection?.()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    if (!normalizeReferenceText(selection.toString())) return
    return { document: doc!, selection } satisfies SelectionSnapshot
  } catch {
    return
  }
}

function currentSelection(root: Document) {
  const docs = sameOriginDocuments(root)
  const active = activeDocument(root)
  const preferred = [active, ...docs.filter((doc) => doc !== active)]
  for (const doc of preferred) {
    const hit = selectionFromDocument(doc)
    if (hit) return hit
  }
}

function bindReferenceCapture() {
  const state: {
    selection?: BrowserReferenceCandidate
    element?: BrowserReferenceCandidate
  } = {}
  let scheduled = false

  const persist = () => {
    const payload = JSON.stringify({
      selection: state.selection ? { ...state.selection } : undefined,
      element: state.element ? { ...state.element } : undefined,
    })
    document.documentElement.setAttribute(BROWSER_REFERENCE_ATTRIBUTE, payload)
  }

  const flush = () => {
    scheduled = false
    persist()
    ipcRenderer.sendToHost(BROWSER_REFERENCE_CHANNEL, {
      selection: state.selection ? { ...state.selection } : undefined,
      element: state.element ? { ...state.element } : undefined,
    })
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(flush)
    window.setTimeout(() => {
      if (!scheduled) return
      flush()
    }, 0)
  }

  const captureSelection = () => {
    const snapshot = currentSelection(document)
    const text = normalizeReferenceText(snapshot?.selection.toString())
    const range = snapshot?.selection.rangeCount ? snapshot.selection.getRangeAt(0) : undefined
    state.selection = text ? elementPayload(range?.commonAncestorContainer, "selection", text) : undefined
    schedule()
  }

  const bindDocumentListeners = (doc: Document) => {
    doc.addEventListener("selectionchange", captureSelection)
    doc.addEventListener("mouseup", captureSelection, true)
    doc.addEventListener("keyup", captureSelection, true)
    doc.defaultView?.addEventListener("mouseup", captureSelection, true)
    doc.defaultView?.addEventListener("keyup", captureSelection, true)
  }

  document.addEventListener(
    "click",
    (event) => {
      state.element = elementPayload(event.target as Node | null | undefined, "element")
      schedule()
    },
    true,
  )
  for (const doc of sameOriginDocuments(document)) bindDocumentListeners(doc)

  captureSelection()
  schedule()
}

function start() {
  bindAutofillPicker()
  bindPasswordCapture()
  bindReferenceCapture()
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", start, { once: true })
} else {
  start()
}
