import { describe, expect, test } from "bun:test"
import { isNavigableSubagent, visibleSubagents } from "./subagent-view"

describe("isNavigableSubagent", () => {
  test("only permits registered visible subagents", () => {
    const actors = [
      { actorID: "main", mode: "main" },
      { actorID: "explore-1", mode: "subagent" },
      { actorID: "writer-1", mode: "subagent", visible: false },
      { actorID: "peer-1", mode: "peer" },
    ]

    expect(isNavigableSubagent(actors, "explore-1")).toBe(true)
    expect(isNavigableSubagent(actors, "main")).toBe(false)
    expect(isNavigableSubagent(actors, "writer-1")).toBe(false)
    expect(isNavigableSubagent(actors, "peer-1")).toBe(false)
    expect(isNavigableSubagent(actors, "missing")).toBe(false)
  })

  test("keeps only visible subagents for the side rail", () => {
    const actors = [
      { actorID: "explore-1", mode: "subagent", description: "Inspect prompt flow" },
      { actorID: "writer-1", mode: "subagent", visible: false, description: "Write summary" },
      { actorID: "peer-1", mode: "peer", description: "Independent session" },
    ]

    expect(visibleSubagents(actors)).toEqual([{ actorID: "explore-1", mode: "subagent", description: "Inspect prompt flow" }])
  })
})
