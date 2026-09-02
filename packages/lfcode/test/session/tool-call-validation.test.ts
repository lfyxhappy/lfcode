import { describe, expect, test } from "bun:test"
import { describeUnavailableTool } from "../../src/session/tool-call-validation"

describe("tool call validation", () => {
  test("reports the canonical active tool set", () => {
    expect(describeUnavailableTool("write", ["read", "search", "edit"])).toBe(
      'Tool "write" is not available in this turn. Available tools: read, search, edit',
    )
  })
})
