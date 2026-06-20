import { describe, expect, test } from "bun:test"
import { BROWSER_HOME_URL } from "@/pages/session/helpers"
import { createBrowserState, normalizeBrowserViewState, syncBrowserViewState } from "./layout"

describe("layout browser state", () => {
  test("creates first browser state on the Bing home page", () => {
    expect(createBrowserState("").url).toBe(BROWSER_HOME_URL)
    expect(createBrowserState("").history).toEqual([BROWSER_HOME_URL])
    expect(createBrowserState("").loading).toBe(true)
  })

  test("normalizes the old empty browser sentinel to the home page", () => {
    const state = normalizeBrowserViewState({
      url: "https://",
      input: "https://",
      history: ["https://"],
      index: 0,
    })

    expect(state?.url).toBe(BROWSER_HOME_URL)
    expect(state?.input).toBe(BROWSER_HOME_URL)
    expect(state?.history).toEqual([BROWSER_HOME_URL])
  })

  test("keeps explicit external browser URLs instead of replacing them with home", () => {
    const state = createBrowserState("https://example.com")

    expect(state.url).toBe("https://example.com")
    expect(state.history).toEqual(["https://example.com"])
    expect(syncBrowserViewState(state, { url: "https://popup.example.com" }).url).toBe("https://popup.example.com")
  })
})
