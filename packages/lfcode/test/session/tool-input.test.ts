import { describe, expect, test } from "bun:test"
import { parseToolInput, toolInputForModel } from "../../src/session/tool-input"

describe("tool input normalization", () => {
  test("parses a JSON object string exactly once", () => {
    expect(parseToolInput('{"operation":{"action":"run"}}')).toEqual({ operation: { action: "run" } })
    expect(toolInputForModel('{"operation":{"action":"run"}}')).toEqual({ operation: { action: "run" } })
  })

  test("does not guess scalar, array, or malformed input", () => {
    expect(parseToolInput('"text"')).toBe('"text"')
    expect(parseToolInput("[]")).toBe("[]")
    expect(parseToolInput('{"operation":}')).toBe('{"operation":}')
    expect(toolInputForModel("not-json")).toEqual({})
  })

  test("keeps object arguments unchanged", () => {
    const value = { operation: { action: "run" } }
    expect(parseToolInput(value)).toBe(value)
    expect(toolInputForModel(value)).toBe(value)
  })
})
