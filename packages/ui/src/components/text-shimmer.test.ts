import { describe, expect, test } from "bun:test"
import { shouldRunTextShimmer } from "./text-shimmer"

describe("TextShimmer", () => {
  test("only runs while the active sweep can be seen", () => {
    expect(shouldRunTextShimmer(true, true, true)).toBe(true)
    expect(shouldRunTextShimmer(false, true, true)).toBe(false)
    expect(shouldRunTextShimmer(true, false, true)).toBe(false)
    expect(shouldRunTextShimmer(true, true, false)).toBe(false)
  })
})
