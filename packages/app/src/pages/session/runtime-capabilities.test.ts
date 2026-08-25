import { describe, expect, test } from "bun:test"
import { canUseTerminal } from "./runtime-capabilities"

describe("session runtime capabilities", () => {
  test("keeps terminal access on Electron and direct local web connections", () => {
    expect(canUseTerminal("desktop", false)).toBe(true)
    expect(canUseTerminal("web", true)).toBe(true)
  })

  test("keeps terminal access for paired remote web connections", () => {
    expect(canUseTerminal("web", false)).toBe(true)
  })
})
