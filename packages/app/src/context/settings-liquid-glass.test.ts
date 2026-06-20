import { describe, expect, test } from "bun:test"
import { liquidGlassDefaults } from "./settings"

describe("liquid glass settings defaults", () => {
  test("uses the shared raycast-style defaults", () => {
    expect(liquidGlassDefaults).toEqual({
      blur: 24,
      opacity: 68,
      highlight: 76,
      tint: 44,
      saturation: 126,
    })
  })
})
