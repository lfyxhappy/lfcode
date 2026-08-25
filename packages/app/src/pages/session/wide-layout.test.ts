import { describe, expect, test } from "bun:test"
import { isWideSessionLayout, wideSessionLayoutMinWidth, wideSessionLayoutQuery } from "./wide-layout"

describe("wide session layout", () => {
  test("aligns with the app shell's lg breakpoint", () => {
    expect(wideSessionLayoutMinWidth).toBe(1024)
    expect(wideSessionLayoutQuery).toBe("(min-width: 1024px)")
  })

  test("uses the desktop session skeleton at and above the breakpoint", () => {
    expect(isWideSessionLayout(1023)).toBe(false)
    expect(isWideSessionLayout(1024)).toBe(true)
    expect(isWideSessionLayout(1232)).toBe(true)
  })
})
