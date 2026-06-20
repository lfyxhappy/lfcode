import { describe, expect, test } from "bun:test"
import { glassStyleText, isLiquidGlassTheme, resetLiquidGlassValues } from "./liquid-glass-theme"

describe("liquid glass theme bridge", () => {
  test("only emits runtime css for the liquid glass theme", () => {
    expect(
      glassStyleText({
        themeId: "nightowl",
        blur: 18,
        opacity: 72,
        highlight: 54,
        tint: 36,
        saturation: 112,
      }),
    ).toBe("")

    expect(
      glassStyleText({
        themeId: "liquid-glass",
        blur: 18,
        opacity: 72,
        highlight: 54,
        tint: 36,
        saturation: 112,
      }),
    ).toContain("--liquid-glass-blur: 18px;")
    expect(
      glassStyleText({
        themeId: "liquid-glass",
        blur: 18,
        opacity: 72,
        highlight: 54,
        tint: 36,
        saturation: 112,
      }),
    ).toContain('[data-component="dialog"][data-size="x-large"] [data-slot="dialog-content"]')
  })

  test("recognizes the liquid glass theme id", () => {
    expect(isLiquidGlassTheme("liquid-glass")).toBe(true)
    expect(isLiquidGlassTheme("lfcode")).toBe(false)
  })

  test("returns stable default liquid glass values", () => {
    expect(resetLiquidGlassValues()).toEqual({
      blur: 24,
      opacity: 68,
      highlight: 76,
      tint: 44,
      saturation: 126,
    })
  })
})
