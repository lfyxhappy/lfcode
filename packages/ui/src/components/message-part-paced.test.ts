import { describe, expect, test } from "bun:test"
import { nextPacedTextBoundary, pacedTextStepSize } from "./message-part-paced"

describe("message-part-paced", () => {
  test("uses smaller step sizes for short text", () => {
    expect(pacedTextStepSize(4)).toBe(2)
    expect(pacedTextStepSize(24)).toBe(4)
    expect(pacedTextStepSize(80)).toBe(8)
  })

  test("caps large step sizes", () => {
    expect(pacedTextStepSize(400)).toBe(24)
  })

  test("extends to the next snap character when nearby", () => {
    expect(nextPacedTextBoundary("hello world", 0)).toBe(6)
    expect(nextPacedTextBoundary("abcd efgh", 0)).toBe(5)
  })

  test("falls back to the computed step when no snap character is nearby", () => {
    expect(nextPacedTextBoundary("abcdefghijklmnop", 0)).toBe(4)
  })
})
