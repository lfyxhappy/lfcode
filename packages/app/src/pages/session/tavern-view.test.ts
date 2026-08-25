import { describe, expect, test } from "bun:test"
import { normalizeTavernViewSettings } from "./tavern-view"

describe("Tavern view settings", () => {
  test("keeps only explicit enabled view modes", () => {
    expect(normalizeTavernViewSettings({ immersive: true, dualView: true })).toEqual({ immersive: true, dualView: true })
    expect(normalizeTavernViewSettings({ immersive: "true", dualView: 1 })).toEqual({ immersive: false, dualView: false })
  })
})
