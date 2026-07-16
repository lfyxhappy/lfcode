import { base64Decode, base64Encode, checksum } from "@lfcode-ai/shared/util/encode"

export const HTML_COMPONENT_EVENT_TYPE = "lfcode.component.event"

const HTML_COMPONENT_READY_TYPE = "lfcode.component.ready"
const HTML_COMPONENT_ERROR_TYPE = "lfcode.component.error"
const HTML_COMPONENT_RESIZE_TYPE = "lfcode.component.resize"
const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 160
const MAX_HEIGHT = 1440
const HEIGHT_STEP = 120
const DEFAULT_TITLE = "Interactive component"
const HTML_COMPONENT_FENCE = String.raw`(?:lfcode-html|<<lfcode>>-<<html>>)`
const HTML_COMPONENT_FENCE_PATTERN = new RegExp(
  '(?:^|\\n)([ \\t]{0,3})([`]{3,}|~{3,})' + HTML_COMPONENT_FENCE + '([^\\n]*)\\n([\\s\\S]*?)\\n\\1\\2[ \\t]*(?=\\n|$)',
  "g",
)

type HtmlComponentMessage =
  | {
      type: typeof HTML_COMPONENT_EVENT_TYPE
      event: string
      payload?: unknown
      state?: unknown
    }
  | {
      type: typeof HTML_COMPONENT_READY_TYPE
    }
  | {
      type: typeof HTML_COMPONENT_ERROR_TYPE
      message?: unknown
    }
  | {
      type: typeof HTML_COMPONENT_RESIZE_TYPE
      height: unknown
    }

export type HtmlComponentContext = {
  sessionID?: string
  messageID?: string
  partID?: string
  role?: string
  agent?: string
  modelProviderID?: string
  modelID?: string
  variant?: string
}

export type HtmlComponentEventDetail = {
  componentID: string
  title: string
  event: string
  payload?: unknown
  state?: unknown
  context?: HtmlComponentContext
}

type HtmlComponentLabels = {
  copy: string
  copied: string
  refresh: string
  shrink: string
  grow: string
  fit: string
  expand: string
  collapse: string
  loading: string
  error: string
}

type HtmlComponentSetupInput = {
  labels: HtmlComponentLabels
  context?: HtmlComponentContext
  onEvent?: (detail: HtmlComponentEventDetail) => void
}

type HtmlComponentMeta = {
  componentID: string
  title: string
  height: number
  source: string
}

function clampHeight(height: number | undefined) {
  if (!height || !Number.isFinite(height)) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)))
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function infoStringValue(info: string, key: string) {
  const pattern = new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|'([^']*)'|([^\\s]+))`, "i")
  const match = info.match(pattern)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function parseHtmlComponentMeta(info: string, source: string): HtmlComponentMeta {
  const title = infoStringValue(info, "title")?.trim() || DEFAULT_TITLE
  const heightValue = Number(infoStringValue(info, "height"))
  const height = clampHeight(Number.isFinite(heightValue) ? heightValue : undefined)
  const componentID = checksum(`${info}\n${source}`) ?? checksum(source) ?? "lfcode-html"
  return {
    componentID,
    title,
    height,
    source,
  }
}

export function replaceHtmlComponentFences(markdown: string) {
  return markdown.replace(HTML_COMPONENT_FENCE_PATTERN, (match, _indent, _fence, info, source) => {
      const meta = parseHtmlComponentMeta(info ?? "", source)
      const encoded = base64Encode(meta.source)
      const title = escapeAttribute(meta.title)
      return match.startsWith("\n")
        ? `\n<div data-component="lfcode-html-placeholder" data-html-component-id="${meta.componentID}" data-html-title="${title}" data-html-height="${meta.height}" data-html-source="${encoded}"></div>`
        : `<div data-component="lfcode-html-placeholder" data-html-component-id="${meta.componentID}" data-html-title="${title}" data-html-height="${meta.height}" data-html-source="${encoded}"></div>`
    })
}

function componentFrameScript() {
  return String.raw`(() => {
  const send = (message) => {
    try {
      parent.postMessage(message, "*")
    } catch {}
  }
  const message = (value) => {
    if (value instanceof Error) return value.message
    if (typeof value === "string") return value
    if (value === undefined || value === null) return ""
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  window.addEventListener("error", (event) => {
    send({ type: "lfcode.component.error", message: event.message || "Script error" })
  })
  window.addEventListener("unhandledrejection", (event) => {
    send({ type: "lfcode.component.error", message: message(event.reason) || "Unhandled rejection" })
  })
  let currentState
  let lastSentAt = 0
  let lastReportedHeight = 0
  let resizeFrame = 0
  const markSent = () => {
    lastSentAt = Date.now()
  }
  const emit = (event, payload, state = currentState) => {
    if (!event || typeof event !== "string") return
    if (state !== undefined) currentState = state
    markSent()
    send({ type: "lfcode.component.event", event, payload, state: currentState })
  }
  const setState = (state) => {
    currentState = state
  }
  const readState = () => currentState
  const reportResize = (height) => {
    if (!Number.isFinite(height) || height <= 0) return
    const next = Math.round(height)
    if (Math.abs(next - lastReportedHeight) < 2) return
    lastReportedHeight = next
    send({ type: "lfcode.component.resize", height: next })
  }
  const measureHeight = () => Math.max(
    document.documentElement?.scrollHeight || 0,
    document.documentElement?.offsetHeight || 0,
    document.body?.scrollHeight || 0,
    document.body?.offsetHeight || 0,
  )
  const scheduleResize = () => {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      reportResize(measureHeight())
    })
  }
  const serializeForm = (form) => {
    const data = {}
    for (const [key, value] of new FormData(form).entries()) {
      if (key in data) {
        const current = data[key]
        data[key] = Array.isArray(current) ? [...current, value] : [current, value]
        continue
      }
      data[key] = value
    }
    return data
  }
  const parseDataValue = (value) => {
    if (value === undefined || value === null || value === "") return undefined
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  const autoPayload = (target, event) => {
    const payload = { tag: target.tagName.toLowerCase() }
    const text = target.textContent?.trim()
    if (text) payload.text = text
    if (target instanceof HTMLInputElement) {
      payload.name = target.name || undefined
      payload.type = target.type || undefined
      payload.value = target.value || undefined
      payload.checked = target.checked
    }
    if (target instanceof HTMLButtonElement) {
      payload.name = target.name || undefined
      payload.value = target.value || undefined
    }
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      payload.name = target.name || undefined
      payload.value = target.value || undefined
    }
    if (target instanceof HTMLAnchorElement) {
      payload.href = target.href || undefined
    }
    if (target instanceof HTMLCanvasElement && event instanceof MouseEvent) {
      const rect = target.getBoundingClientRect()
      payload.x = Math.round(event.clientX - rect.left)
      payload.y = Math.round(event.clientY - rect.top)
      payload.width = Math.round(rect.width)
      payload.height = Math.round(rect.height)
    }
    return payload
  }
  const bridge = {
    emit,
    setState,
    getState: readState,
    resize: (height) => reportResize(Number(height)),
  }
  globalThis.lfcode = bridge
  globalThis.LFCODE = bridge
  document.addEventListener("click", (event) => {
    if (Date.now() - lastSentAt < 32) return
    const target = event.target instanceof Element
      ? event.target.closest("[data-lfcode-event],button,a[href],input,select,textarea,canvas,[role='button']")
      : null
    if (!(target instanceof HTMLElement)) return
    const eventName = target.dataset.lfcodeEvent?.trim() || "click"
    const payload = parseDataValue(target.dataset.lfcodePayload) ?? autoPayload(target, event)
    const state = parseDataValue(target.dataset.lfcodeState) ?? currentState
    emit(eventName, payload, state)
  })
  document.addEventListener("change", (event) => {
    if (Date.now() - lastSentAt < 32) return
    const target = event.target instanceof Element
      ? event.target.closest("[data-lfcode-event],input,select,textarea")
      : null
    if (!(target instanceof HTMLElement)) return
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return
    const eventName = target.dataset.lfcodeEvent?.trim() || "change"
    const payload = parseDataValue(target.dataset.lfcodePayload) ?? autoPayload(target, event)
    const state = parseDataValue(target.dataset.lfcodeState) ?? currentState
    emit(eventName, payload, state)
  })
  document.addEventListener("submit", (event) => {
    if (Date.now() - lastSentAt < 32) return
    const form = event.target instanceof HTMLFormElement ? event.target : null
    if (!form) return
    const eventName = form.dataset.lfcodeEvent?.trim() || "submit"
    const payload = parseDataValue(form.dataset.lfcodePayload) ?? serializeForm(form)
    const state = parseDataValue(form.dataset.lfcodeState) ?? currentState
    emit(eventName, payload, state)
  })
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => scheduleResize())
    const connect = () => {
      observer.observe(document.documentElement)
      if (document.body) observer.observe(document.body)
      scheduleResize()
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", connect, { once: true })
    } else {
      connect()
    }
  }
  window.addEventListener("load", () => scheduleResize())
  window.addEventListener("resize", () => scheduleResize())
  const ready = () => {
    scheduleResize()
    send({ type: "lfcode.component.ready" })
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true })
  } else {
    ready()
  }
})()`
}

function composeHtmlComponentDocument(source: string) {
  const extras = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; font-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval' blob:; connect-src * data: blob:; frame-src * data: blob:;">`,
    `<base target="_blank">`,
  ].join("")
  const bootstrap = `<script>${componentFrameScript()}<\/script>`

  if (!/(?:<!doctype|<html\b)/i.test(source)) {
    return `<!doctype html><html><head>${extras}</head><body>${bootstrap}${source}</body></html>`
  }

  let documentSource = source
  if (/<head\b[^>]*>/i.test(documentSource)) {
    documentSource = documentSource.replace(/<head\b([^>]*)>/i, `<head$1>${extras}`)
  } else if (/<html\b[^>]*>/i.test(documentSource)) {
    documentSource = documentSource.replace(/<html\b([^>]*)>/i, `<html$1><head>${extras}</head>`)
  } else {
    documentSource = `${extras}${documentSource}`
  }

  if (/<body\b[^>]*>/i.test(documentSource)) {
    documentSource = documentSource.replace(/<body\b([^>]*)>/i, `<body$1>${bootstrap}`)
    return documentSource
  }

  if (/<\/head>/i.test(documentSource)) {
    return documentSource.replace(/<\/head>/i, `</head><body>${bootstrap}</body>`)
  }

  return `${documentSource}<body>${bootstrap}</body>`
}

function htmlComponentMessage(data: unknown): HtmlComponentMessage | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const type = "type" in data ? data.type : undefined
  if (type === HTML_COMPONENT_READY_TYPE) return { type }
  if (type === HTML_COMPONENT_ERROR_TYPE) {
    return {
      type,
      message: "message" in data ? data.message : undefined,
    }
  }
  if (type === HTML_COMPONENT_RESIZE_TYPE) {
    return {
      type,
      height: "height" in data ? data.height : undefined,
    }
  }
  if (type !== HTML_COMPONENT_EVENT_TYPE) return
  if (!("event" in data) || typeof data.event !== "string" || !data.event) return
  return {
    type,
    event: data.event,
    payload: "payload" in data ? data.payload : undefined,
    state: "state" in data ? data.state : undefined,
  }
}

function htmlComponentErrorText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value instanceof Error && value.message) return value.message
  return fallback
}

function copyTooltip(button: HTMLButtonElement, labels: HtmlComponentLabels, copied: boolean) {
  button.dataset.tooltip = copied ? labels.copied : labels.copy
  button.textContent = copied ? labels.copied : labels.copy
}

function frameMeta(node: HTMLElement) {
  const source = node.dataset.htmlSource
  const title = node.dataset.htmlTitle
  const componentID = node.dataset.htmlComponentId
  const height = Number(node.dataset.htmlHeight)
  if (!source || !title || !componentID) return
  return {
    source: base64Decode(source),
    title,
    componentID,
    height: clampHeight(height),
  } satisfies HtmlComponentMeta
}

export function setupHtmlComponents(root: HTMLDivElement, input: HtmlComponentSetupInput) {
  const placeholders = Array.from(root.querySelectorAll('[data-component="lfcode-html-placeholder"]')).filter(
    (item): item is HTMLElement => item instanceof HTMLElement,
  )
  if (placeholders.length === 0) return

  const cleanups: Array<() => void> = []
  for (const placeholder of placeholders) {
    const meta = frameMeta(placeholder)
    if (!meta) continue

    const frame = document.createElement("section")
    frame.setAttribute("data-component", "lfcode-html-frame")
    frame.dataset.htmlComponentId = meta.componentID

    const header = document.createElement("div")
    header.setAttribute("data-slot", "lfcode-html-header")

    const title = document.createElement("span")
    title.setAttribute("data-slot", "lfcode-html-title")
    title.textContent = meta.title

    const actions = document.createElement("div")
    actions.setAttribute("data-slot", "lfcode-html-actions")

    const copy = document.createElement("button")
    copy.type = "button"
    copy.setAttribute("data-slot", "lfcode-html-copy")
    copyTooltip(copy, input.labels, false)

    const shrink = document.createElement("button")
    shrink.type = "button"
    shrink.setAttribute("data-slot", "lfcode-html-shrink")
    shrink.textContent = input.labels.shrink

    const grow = document.createElement("button")
    grow.type = "button"
    grow.setAttribute("data-slot", "lfcode-html-grow")
    grow.textContent = input.labels.grow

    const fit = document.createElement("button")
    fit.type = "button"
    fit.setAttribute("data-slot", "lfcode-html-fit")
    fit.textContent = input.labels.fit

    const expand = document.createElement("button")
    expand.type = "button"
    expand.setAttribute("data-slot", "lfcode-html-expand")
    expand.textContent = input.labels.expand

    const refresh = document.createElement("button")
    refresh.type = "button"
    refresh.setAttribute("data-slot", "lfcode-html-refresh")
    refresh.textContent = input.labels.refresh

    ;[shrink, grow, fit, expand, copy, refresh].forEach((action) => actions.appendChild(action))
    header.appendChild(title)
    header.appendChild(actions)

    const body = document.createElement("div")
    body.setAttribute("data-slot", "lfcode-html-body")
    const state = {
      height: meta.height,
      maxObservedHeight: meta.height,
      manualHeight: false,
      expanded: false,
    }
    const applyHeight = (height: number) => {
      state.height = clampHeight(height)
      body.style.height = `${state.height}px`
    }
    const syncExpandLabel = () => {
      expand.textContent = state.expanded ? input.labels.collapse : input.labels.expand
      frame.dataset.expanded = state.expanded ? "true" : "false"
    }
    applyHeight(meta.height)
    syncExpandLabel()

    const status = document.createElement("div")
    status.setAttribute("data-slot", "lfcode-html-status")
    status.textContent = input.labels.loading

    const iframe = document.createElement("iframe")
    iframe.setAttribute("data-slot", "lfcode-html-iframe")
    iframe.setAttribute("sandbox", "allow-scripts allow-forms")
    iframe.setAttribute("referrerpolicy", "no-referrer")
    iframe.setAttribute("loading", "lazy")
    iframe.title = meta.title

    const setSrcdoc = () => {
      status.textContent = input.labels.loading
      status.dataset.state = "loading"
      iframe.srcdoc = composeHtmlComponentDocument(meta.source)
    }

    const ready = () => {
      status.textContent = ""
      status.dataset.state = "ready"
    }

    const fail = (message?: unknown) => {
      status.textContent = htmlComponentErrorText(message, input.labels.error)
      status.dataset.state = "error"
    }

    setSrcdoc()
    body.appendChild(iframe)
    body.appendChild(status)
    frame.appendChild(header)
    frame.appendChild(body)
    placeholder.replaceWith(frame)

    const refreshClick = () => {
      state.manualHeight = false
      setSrcdoc()
    }
    const shrinkClick = () => {
      state.manualHeight = true
      applyHeight(state.height - HEIGHT_STEP)
    }
    const growClick = () => {
      state.manualHeight = true
      applyHeight(state.height + HEIGHT_STEP)
    }
    const fitClick = () => {
      state.manualHeight = false
      applyHeight(state.maxObservedHeight)
    }
    const expandClick = () => {
      state.expanded = !state.expanded
      syncExpandLabel()
    }
    const copyListener = () => void copyClick()
    const copyClick = async () => {
      if (!navigator.clipboard) return
      await navigator.clipboard.writeText(meta.source)
      copyTooltip(copy, input.labels, true)
      const timeout = setTimeout(() => copyTooltip(copy, input.labels, false), 2000)
      cleanups.push(() => clearTimeout(timeout))
    }
    const onError = () => fail()
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      const message = htmlComponentMessage(event.data)
      if (!message) return
      if (message.type === HTML_COMPONENT_READY_TYPE) {
        ready()
        return
      }
      if (message.type === HTML_COMPONENT_ERROR_TYPE) {
        fail(message.message)
        return
      }
      if (message.type === HTML_COMPONENT_RESIZE_TYPE) {
        const next = clampHeight(Number(message.height))
        if (!Number.isFinite(next)) return
        state.maxObservedHeight = Math.max(state.maxObservedHeight, next)
        if (!state.manualHeight) applyHeight(state.maxObservedHeight)
        return
      }
      ready()
      input.onEvent?.({
        componentID: meta.componentID,
        title: meta.title,
        event: message.event,
        payload: message.payload,
        state: message.state,
        context: input.context,
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !state.expanded) return
      state.expanded = false
      syncExpandLabel()
    }

    refresh.addEventListener("click", refreshClick)
    shrink.addEventListener("click", shrinkClick)
    grow.addEventListener("click", growClick)
    fit.addEventListener("click", fitClick)
    expand.addEventListener("click", expandClick)
    copy.addEventListener("click", copyListener)
    iframe.addEventListener("error", onError)
    window.addEventListener("message", onMessage)
    window.addEventListener("keydown", onKeyDown)

    cleanups.push(() => refresh.removeEventListener("click", refreshClick))
    cleanups.push(() => shrink.removeEventListener("click", shrinkClick))
    cleanups.push(() => grow.removeEventListener("click", growClick))
    cleanups.push(() => fit.removeEventListener("click", fitClick))
    cleanups.push(() => expand.removeEventListener("click", expandClick))
    cleanups.push(() => copy.removeEventListener("click", copyListener))
    cleanups.push(() => iframe.removeEventListener("error", onError))
    cleanups.push(() => window.removeEventListener("message", onMessage))
    cleanups.push(() => window.removeEventListener("keydown", onKeyDown))
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
