import { describe, expect, test } from "bun:test"
import { prependsTimelineTurns } from "./timeline-virtual-direction"

describe("prepending virtual timeline turns", () => {
  test("does not shift measurements when a prompt appends a turn", () => {
    expect(prependsTimelineTurns(["turn-1", "turn-2"], ["turn-1", "turn-2", "turn-3"])).toBe(false)
  })

  test("shifts measurements only when history prepends turns", () => {
    expect(prependsTimelineTurns(["turn-3", "turn-4"], ["turn-1", "turn-2", "turn-3", "turn-4"])).toBe(true)
  })

  test("does not shift when a window is replaced", () => {
    expect(prependsTimelineTurns(["turn-1", "turn-2"], ["turn-4", "turn-5", "turn-6"])).toBe(false)
  })
})
