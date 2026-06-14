import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createSessionKeyReader,
  ensureSessionKey,
  normalizeBrowserViewState,
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
      const read = createSessionKeyReader(key, (value) => seen.push(value))

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
      input: "example.com",
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
