import { describe, expect, test } from "bun:test"
import { formatTokenCount } from "./token-format"

describe("formatTokenCount", () => {
  test("uses a stable K/M/B unit regardless of locale", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(1_250)).toBe("1.3K")
    expect(formatTokenCount(1_500_000)).toBe("1.5M")
    expect(formatTokenCount(1_500_000_000)).toBe("1.5B")
  })

  test("preserves sign and handles non-finite values", () => {
    expect(formatTokenCount(-1_500)).toBe("-1.5K")
    expect(formatTokenCount(Number.NaN)).toBe("—")
  })
})
