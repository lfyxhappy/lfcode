import { batch, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { same } from "@/utils/same"

const emptyTabs: string[] = []
const BROWSER_TAB_PREFIX = "browser://"
const SIDE_CHAT_TAB_PREFIX = "side-chat://"
const EMPTY_BROWSER_URL = "https://"
export const BROWSER_HOME_URL = "https://www.bing.com"
export const DEFAULT_BROWSER_URL = BROWSER_HOME_URL
const ALLOWED_BROWSER_PROTOCOLS = new Set(["http:", "https:", "file:"])

export const BROWSER_REQUEST_OPEN_EVENT = "lfcode:browser-request-open"
export const BROWSER_COMMAND_EVENT = "lfcode:browser-command"

export type BrowserOpenRequestDetail = {
  url?: string
  sessionKey?: string
  sessionID?: string
  title?: string
  reason?: "human" | "tool"
  presentation?: "headless" | "detached" | "sidebar"
  newTab?: boolean
  tabID?: string
  requestID?: string
}

export const isBrowserTab = (tab: string) => tab.startsWith(BROWSER_TAB_PREFIX)

export const browserTab = (id: string) => `${BROWSER_TAB_PREFIX}${id}`

export const browserTabID = (tab: string) => {
  if (!isBrowserTab(tab)) return undefined
  return tab.slice(BROWSER_TAB_PREFIX.length)
}

export const isSideChatTab = (tab: string) => tab.startsWith(SIDE_CHAT_TAB_PREFIX)

export const sideChatTab = (id: string) => `${SIDE_CHAT_TAB_PREFIX}${id}`

export const sideChatTabID = (tab: string) => {
  if (!isSideChatTab(tab)) return undefined
  return tab.slice(SIDE_CHAT_TAB_PREFIX.length)
}

export const createBrowserTabID = () =>
  `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const createSideChatTabID = () =>
  `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const createBrowserRequestID = () =>
  `browser-open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const sanitizeBrowserURL = (value: string) => {
  const next = value.trim()
  if (!next) return DEFAULT_BROWSER_URL
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])(?::\d+)?(?:[/?#].*)?$/.test(next)) {
    return `http://${next}`
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(next)) return next
  return `https://${next}`
}

export const isAllowedBrowserURL = (value: string) => {
  if (value.trim() === EMPTY_BROWSER_URL || value.trim() === DEFAULT_BROWSER_URL) return true
  try {
    const url = new URL(sanitizeBrowserURL(value))
    return ALLOWED_BROWSER_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

export const normalizeBrowserURL = (value: string) => {
  const next = sanitizeBrowserURL(value)
  if (next === EMPTY_BROWSER_URL) return DEFAULT_BROWSER_URL
  if (next === DEFAULT_BROWSER_URL) return next
  if (!isAllowedBrowserURL(next)) return undefined
  return next
}

export const normalizeBrowserRequestURL = (value?: string) => normalizeBrowserURL(value ?? DEFAULT_BROWSER_URL)

export const formatBrowserTabLabel = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`
  } catch {
    return value
  }
}

type Tabs = {
  active: Accessor<string | undefined>
  all: Accessor<string[]>
}

type TabsInput = {
  tabs: Accessor<Tabs>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
  detachedTabs?: Accessor<string[]>
  forcedTab?: Accessor<string | undefined>
}

export const getSessionKey = (dir: string | undefined, id: string | undefined) => `${dir ?? ""}${id ? `/${id}` : ""}`

export const createSessionTabs = (input: TabsInput) => {
  const review = input.review ?? (() => false)
  const hasReview = input.hasReview ?? (() => false)
  const detachedTabs = input.detachedTabs ?? (() => emptyTabs)
  const forcedTab = input.forcedTab ?? (() => undefined)
  const openedTabs = createMemo(
    () => {
      const seen = new Set<string>()
      return input
        .tabs()
        .all()
        .flatMap((tab) => {
          if (detachedTabs().includes(tab)) return []
          if (tab === "review") return []
          if (isBrowserTab(tab) || isSideChatTab(tab)) return seen.has(tab) ? [] : (seen.add(tab), [tab])
          const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
          if (seen.has(value)) return []
          seen.add(value)
          return [value]
        })
    },
    emptyTabs,
    { equals: same },
  )
  const activeTab = createMemo(() => {
    const pinned = forcedTab()
    if (pinned) return pinned
    const active = input.tabs().active()
    if (detachedTabs().includes(active ?? "")) {
      const first = openedTabs()[0]
      if (first) return first
      if (review() && hasReview()) return "review"
      return "empty"
    }
    if (active === "review" && review()) return active
    if (active && (isBrowserTab(active) || isSideChatTab(active))) return active
    if (active && input.pathFromTab(active)) return input.normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (review() && hasReview()) return "review"
    return "empty"
  })
  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (isBrowserTab(active) || isSideChatTab(active)) return
    if (!openedTabs().includes(active)) return
    return active
  })
  const closableTab = createMemo(() => {
    const active = activeTab()
    if (isBrowserTab(active) || isSideChatTab(active)) return active
    if (!openedTabs().includes(active)) return
    return active
  })

  return {
    openedTabs,
    activeTab,
    activeFileTab,
    closableTab,
  }
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

const skip = new Set(["Alt", "Control", "Meta", "Shift"])

export const shouldFocusTerminalOnKeyDown = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) => {
  if (skip.has(event.key)) return false
  return !(event.ctrlKey || event.metaKey || event.altKey)
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) void maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)
    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) {
      input.openReviewPanel()
      input.setActive(next)
      return
    }

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>
