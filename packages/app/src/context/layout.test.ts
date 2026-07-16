import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createSessionKeyReader,
  ensureSessionKey,
  normalizeBrowserViewState,
  normalizeStoredSessionView,
  pruneSessionKeys,
  syncBrowserViewState,
} from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => {
        seen.push(value)
        return value
      })

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

describe("browser view state helpers", () => {
  test("normalizes incomplete persisted browser state", () => {
    const result = normalizeBrowserViewState({
      url: "example.com",
      input: "example.com",
      history: ["example.com", "https://two.example.com"],
      index: 99,
    })

    expect(result).toEqual({
      url: "https://two.example.com",
      input: "https://example.com",
      title: undefined,
      history: ["https://example.com", "https://two.example.com"],
      index: 1,
      loading: true,
      canGoBack: true,
      canGoForward: false,
      error: undefined,
    })
  })

  test("syncs browser navigation into persistent history", () => {
    const result = syncBrowserViewState(
      {
        url: "https://example.com",
        input: "https://example.com",
        title: "Example",
        history: ["https://example.com"],
        index: 0,
        loading: true,
        canGoBack: false,
        canGoForward: false,
        error: undefined,
      },
      {
        url: "https://two.example.com",
        input: "https://two.example.com",
        loading: false,
      },
    )

    expect(result.history).toEqual(["https://example.com", "https://two.example.com"])
    expect(result.index).toBe(1)
    expect(result.canGoBack).toBe(true)
    expect(result.canGoForward).toBe(false)
  })

  test("treats adjacent history hits as back-forward navigation", () => {
    const result = syncBrowserViewState(
      {
        url: "https://two.example.com",
        input: "https://two.example.com",
        title: "Two",
        history: ["https://example.com", "https://two.example.com", "https://three.example.com"],
        index: 1,
        loading: true,
        canGoBack: true,
        canGoForward: true,
        error: undefined,
      },
      {
        url: "https://example.com",
        input: "https://example.com",
        loading: false,
      },
    )

    expect(result.history).toEqual(["https://example.com", "https://two.example.com", "https://three.example.com"])
    expect(result.index).toBe(0)
    expect(result.canGoBack).toBe(false)
    expect(result.canGoForward).toBe(true)
  })
})

describe("session view migration", () => {
  test("drops legacy viewport and pixel scroll state", () => {
    const result = normalizeStoredSessionView({
      scroll: {
        session: { x: 3, y: 240 },
      },
      viewportSnapshot: {
        mode: "anchor",
        anchorMessageId: "msg_anchor",
        anchorOffsetPx: 9,
        updatedAt: 99,
      },
      timelineMessageID: "msg_1",
      pendingMessage: "msg_stale",
      pendingMessageAt: 123,
      sideChat: { opened: true },
      reviewOpen: ["a", "a", 1],
    })

    expect(result).toEqual({
      changed: true,
      view: {
        scroll: {},
        viewportSnapshot: undefined,
        turnStart: undefined,
        reviewEnabled: undefined,
        summaryCard: undefined,
        reviewOpen: ["a"],
        browser: undefined,
      },
    })
  })

  test("drops invalid viewport snapshot payloads", () => {
    const result = normalizeStoredSessionView({
      scroll: {
        session: { x: 1, y: 2 },
      },
      viewportSnapshot: {
        mode: "anchor",
        anchorMessageId: "",
        anchorOffsetPx: "bad",
      },
    })

    expect(result).toEqual({
      changed: true,
      view: {
        scroll: {},
        viewportSnapshot: undefined,
        turnStart: undefined,
        reviewEnabled: undefined,
        summaryCard: undefined,
        reviewOpen: undefined,
        browser: undefined,
      },
    })
  })

  test("keeps explicit review enabled state", () => {
    const result = normalizeStoredSessionView({
      scroll: {
        session: { x: 1, y: 2 },
      },
      reviewEnabled: true,
    })

    expect(result).toEqual({
      changed: true,
      view: {
        scroll: {},
        viewportSnapshot: undefined,
        turnStart: undefined,
        reviewEnabled: true,
        summaryCard: undefined,
        reviewOpen: undefined,
        browser: undefined,
      },
    })
  })

  test("keeps a complete V3 anchor snapshot", () => {
    const result = normalizeStoredSessionView({
      scroll: { review: { x: 1, y: 2 } },
      viewportSnapshot: {
        version: 3,
        mode: "anchor",
        assistantRevision: "msg-2\nidle",
        historyTurnStart: 3,
        anchorBlockId: "msg-1:part-1",
        anchorTurnId: "msg-1",
        anchorOffsetPx: 24,
        updatedAt: 44,
      },
    })

    expect(result).toEqual({
      changed: false,
      view: {
        scroll: { review: { x: 1, y: 2 } },
        viewportSnapshot: {
          version: 3,
          mode: "anchor",
          assistantRevision: "msg-2\nidle",
          historyTurnStart: 3,
          anchorBlockId: "msg-1:part-1",
          anchorTurnId: "msg-1",
          anchorOffsetPx: 24,
          updatedAt: 44,
        },
        turnStart: undefined,
        reviewEnabled: undefined,
        summaryCard: undefined,
        reviewOpen: undefined,
        browser: undefined,
      },
    })
  })

  test("keeps explicit summary card state", () => {
    const result = normalizeStoredSessionView({
      scroll: {},
      summaryCard: false,
    })

    expect(result).toEqual({
      changed: false,
      view: {
        scroll: {},
        viewportSnapshot: undefined,
        sessionState: undefined,
        turnStart: undefined,
        reviewEnabled: undefined,
        summaryCard: false,
        reviewOpen: undefined,
        browser: undefined,
      },
    })
  })
})
