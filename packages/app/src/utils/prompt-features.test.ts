import { describe, expect, test } from "bun:test"
import { nextPromptFeatures, normalizePromptFeatures, promptFeaturesSystem } from "./prompt-features"

describe("prompt features helpers", () => {
  test("normalizes to known unique features", () => {
    expect(normalizePromptFeatures(["browser-rendering", "browser-rendering", "unknown"])).toEqual([
      "browser-rendering",
    ])
    expect(normalizePromptFeatures("bad")).toEqual([])
  })

  test("adds and removes features deterministically", () => {
    expect(nextPromptFeatures([], "browser-rendering", true)).toEqual(["browser-rendering"])
    expect(nextPromptFeatures(["browser-rendering"], "browser-rendering", true)).toEqual(["browser-rendering"])
    expect(nextPromptFeatures(["browser-rendering"], "browser-rendering", false)).toEqual([])
  })

  test("builds system reminder only when features are enabled", () => {
    expect(promptFeaturesSystem([])).toBeUndefined()
    expect(promptFeaturesSystem(["browser-rendering"])).toContain("<system-reminder>")
  })
})
