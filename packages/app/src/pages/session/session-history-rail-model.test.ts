import { describe, expect, test } from "bun:test"
import {
  buildSessionHistoryRailNodes,
  clampSessionHistoryRailPosition,
  nearestSessionHistoryRailNode,
  resolveSessionHistoryRailTurnIndex,
  sessionHistoryRailScrollPosition,
  stepSessionHistoryRailIndex,
} from "./session-history-rail-model"

describe("session history rail model", () => {
  test("normalizes rail positions and creates evenly spaced nodes", () => {
    expect(clampSessionHistoryRailPosition(-1)).toBe(0)
    expect(clampSessionHistoryRailPosition(2)).toBe(1)
    expect(clampSessionHistoryRailPosition(Number.NaN)).toBe(0)
    expect(buildSessionHistoryRailNodes(["first", "middle", "last"])) .toEqual([
      { turnID: "first", index: 0, position: 0 },
      { turnID: "middle", index: 1, position: 0.5 },
      { turnID: "last", index: 2, position: 1 },
    ])
  })

  test("clamps scroll coordinates and selects the nearest turn", () => {
    const nodes = buildSessionHistoryRailNodes(["first", "middle", "last"])
    expect(sessionHistoryRailScrollPosition({ scrollTop: -10, scrollHeight: 1000, viewportHeight: 400 })).toBe(0)
    expect(sessionHistoryRailScrollPosition({ scrollTop: 800, scrollHeight: 1000, viewportHeight: 400 })).toBe(1)
    expect(nearestSessionHistoryRailNode(nodes, 0.62)?.turnID).toBe("middle")
    expect(nearestSessionHistoryRailNode(nodes, 1.2)?.turnID).toBe("last")
  })

  test("uses a rendered reading anchor before falling back to the scroll position", () => {
    const turnIDs = ["turn-0", "turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]
    expect(
      resolveSessionHistoryRailTurnIndex({
        turnIDs,
        currentTurnID: "turn-1",
        renderedTurnIDs: ["turn-0", "turn-1", "turn-2"],
        scrollTop: 600,
        scrollHeight: 1000,
        viewportHeight: 400,
      }),
    ).toBe(1)
    expect(
      resolveSessionHistoryRailTurnIndex({
        turnIDs,
        renderedTurnIDs: ["turn-2", "turn-3", "turn-4"],
        turnStart: 2,
        scrollTop: 300,
        scrollHeight: 900,
        viewportHeight: 300,
      }),
    ).toBe(3)
  })

  test("steps through turns with line and page keys", () => {
    expect(stepSessionHistoryRailIndex({ index: 2, key: "ArrowUp", length: 5 })).toBe(1)
    expect(stepSessionHistoryRailIndex({ index: 2, key: "ArrowDown", length: 5 })).toBe(3)
    expect(stepSessionHistoryRailIndex({ index: 2, key: "PageUp", length: 5, pageSize: 3 })).toBe(0)
    expect(stepSessionHistoryRailIndex({ index: 0, key: "PageDown", length: 5, pageSize: 3 })).toBe(3)
    expect(stepSessionHistoryRailIndex({ index: 2, key: "Home", length: 5 })).toBe(0)
    expect(stepSessionHistoryRailIndex({ index: 2, key: "End", length: 5 })).toBe(4)
  })
})
