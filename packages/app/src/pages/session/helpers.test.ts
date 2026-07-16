import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  BROWSER_HOME_URL,
  browserTab,
  browserTabID,
  createOpenReviewFile,
  createOpenSessionFileTab,
  createSessionTabs,
  focusTerminalById,
  getTabReorderIndex,
  isBrowserTab,
  isAllowedBrowserURL,
  normalizeBrowserRequestURL,
  normalizeBrowserURL,
  sanitizeBrowserURL,
  isSideChatTab,
  sideChatTab,
  sideChatTabID,
  shouldFocusTerminalOnKeyDown,
} from "./helpers"

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      setActive: (tab) => calls.push(`active:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts", "active:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("shouldFocusTerminalOnKeyDown", () => {
  test("skips pure modifier keys", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Alt", altKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }))).toBe(false)
  })

  test("skips shortcut key combos", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }))).toBe(false)
  })

  test("keeps plain typing focused on terminal", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(true)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "A", shiftKey: true }))).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("createSessionTabs", () => {
  test("normalizes the effective file tab", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["file://src/a.ts", "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
      })

      expect(result.activeTab()).toBe("norm:src/a.ts")
      expect(result.activeFileTab()).toBe("norm:src/a.ts")
      expect(result.closableTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })

  test("prefers context and review fallbacks when no file tab is active", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("context")
      expect(result.closableTab()).toBe("context")
      dispose()
    })

    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("review")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })

  test("falls back to empty when review tab is not explicitly enabled", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => false,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("empty")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })

  test("keeps browser tabs active and closable", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: browserTab("tab-1"),
        all: [browserTab("tab-1"), "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
      })

      expect(result.activeTab()).toBe(browserTab("tab-1"))
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBe(browserTab("tab-1"))
      dispose()
    })
  })

  test("keeps side chat tabs active and closable without treating them as file tabs", () => {
    createRoot((dispose) => {
      const tab = sideChatTab("session-1")
      const [state] = createStore({
        active: tab,
        all: [tab, "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
      })

      expect(result.activeTab()).toBe(tab)
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBe(tab)
      dispose()
    })
  })
})

describe("browser tab helpers", () => {
  test("identifies browser tabs and extracts ids", () => {
    expect(isBrowserTab(browserTab("abc"))).toBe(true)
    expect(isBrowserTab("file://src/a.ts")).toBe(false)
    expect(browserTabID(browserTab("abc"))).toBe("abc")
    expect(browserTabID("context")).toBeUndefined()
  })

  test("normalizes browser urls", () => {
    expect(sanitizeBrowserURL("")).toBe(BROWSER_HOME_URL)
    expect(sanitizeBrowserURL("example.com")).toBe("https://example.com")
    expect(sanitizeBrowserURL("https://example.com")).toBe("https://example.com")
    expect(sanitizeBrowserURL("file:///C:/tmp/demo.txt")).toBe("file:///C:/tmp/demo.txt")
    expect(sanitizeBrowserURL("localhost:5173")).toBe("http://localhost:5173")
    expect(sanitizeBrowserURL("127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path")
  })

  test("allows only supported embedded browser protocols", () => {
    expect(isAllowedBrowserURL("https://")).toBe(true)
    expect(isAllowedBrowserURL(BROWSER_HOME_URL)).toBe(true)
    expect(isAllowedBrowserURL("https://example.com")).toBe(true)
    expect(isAllowedBrowserURL("http://example.com")).toBe(true)
    expect(isAllowedBrowserURL("file:///C:/tmp/demo.txt")).toBe(true)
    expect(isAllowedBrowserURL("javascript:alert(1)")).toBe(false)
    expect(isAllowedBrowserURL("mailto:test@example.com")).toBe(false)
  })

  test("normalizes and rejects unsupported browser urls", () => {
    expect(normalizeBrowserURL("")).toBe(BROWSER_HOME_URL)
    expect(normalizeBrowserURL("https://")).toBe(BROWSER_HOME_URL)
    expect(normalizeBrowserURL("example.com")).toBe("https://example.com")
    expect(normalizeBrowserURL("file:///C:/tmp/demo.txt")).toBe("file:///C:/tmp/demo.txt")
    expect(normalizeBrowserURL("javascript:alert(1)")).toBeUndefined()
    expect(normalizeBrowserURL("custom-scheme://test")).toBeUndefined()
  })

  test("defaults browser open requests without a url to the home page", () => {
    expect(normalizeBrowserRequestURL()).toBe(BROWSER_HOME_URL)
    expect(normalizeBrowserRequestURL("")).toBe(BROWSER_HOME_URL)
    expect(normalizeBrowserRequestURL("https://example.com")).toBe("https://example.com")
  })
})

describe("side chat tab helpers", () => {
  test("identifies side chat tabs and extracts ids", () => {
    expect(isSideChatTab(sideChatTab("abc"))).toBe(true)
    expect(isSideChatTab("file://src/a.ts")).toBe(false)
    expect(sideChatTabID(sideChatTab("abc"))).toBe("abc")
    expect(sideChatTabID("context")).toBeUndefined()
  })
})
