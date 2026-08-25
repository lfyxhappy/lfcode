import { describe, expect, test } from "bun:test"
import { SUBAGENT_PRESETS, subagentPresetContext, subagentPresetExecution } from "./subagent-presets"

describe("subagent presets", () => {
  test("registers the complete product role library", () => {
    expect(SUBAGENT_PRESETS.map((item) => item.id)).toEqual([
      "general",
      "explore",
      "planner",
      "implementer",
      "reviewer",
      "tester",
      "debugger",
      "frontend",
      "docs",
      "researcher",
      "security",
      "performance",
      "database",
      "release",
    ])
  })

  test("uses blocking defaults only for implementation-oriented roles", () => {
    expect(subagentPresetExecution("planner")).toBe("wait")
    expect(subagentPresetExecution("implementer")).toBe("wait")
    expect(subagentPresetExecution("explore")).toBe("background")
    expect(subagentPresetContext("unknown")).toBe("state")
  })

  test("keeps native context defaults aligned with the runtime registry", () => {
    expect(subagentPresetContext("planner")).toBe("full")
    expect(subagentPresetContext("reviewer")).toBe("full")
    expect(subagentPresetContext("security")).toBe("full")
    expect(subagentPresetContext("researcher")).toBe("none")
  })
})
