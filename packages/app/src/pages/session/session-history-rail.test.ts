import { describe, expect, test } from "bun:test"
import { sessionHistoryRailKeyboardIndex, sessionHistoryRailTurnAtPosition } from "./session-history-rail"

describe("session history rail interaction adapter", () => {
  test("maps keyboard commands to the next rail turn", () => {
    expect(sessionHistoryRailKeyboardIndex({ index: 2, key: "ArrowUp", length: 5 })).toBe(1)
    expect(sessionHistoryRailKeyboardIndex({ index: 2, key: "ArrowDown", length: 5 })).toBe(3)
    expect(sessionHistoryRailKeyboardIndex({ index: 2, key: "PageUp", length: 5, pageSize: 3 })).toBe(0)
    expect(sessionHistoryRailKeyboardIndex({ index: 0, key: "PageDown", length: 5, pageSize: 3 })).toBe(3)
    expect(sessionHistoryRailKeyboardIndex({ index: 2, key: "Home", length: 5 })).toBe(0)
    expect(sessionHistoryRailKeyboardIndex({ index: 2, key: "End", length: 5 })).toBe(4)
  })

  test("maps click and drag coordinates to the nearest turn", () => {
    expect(sessionHistoryRailTurnAtPosition(["first", "middle", "last"], -0.1)).toBe("first")
    expect(sessionHistoryRailTurnAtPosition(["first", "middle", "last"], 0.62)).toBe("middle")
    expect(sessionHistoryRailTurnAtPosition(["first", "middle", "last"], 1.1)).toBe("last")
  })
})
