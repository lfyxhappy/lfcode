import { describe, expect, test } from "bun:test"
import { Command } from "../../src/command"
import { AgentPreset } from "../../src/agent/preset"

describe("/deep-research command", () => {
  test("Default has the deep-research name", () => {
    expect(Command.Default.DEEP_RESEARCH).toBe("deep-research")
  })

  test("uses the hidden research coordinator rather than the retired workflow route", () => {
    const coordinator = AgentPreset.get("deep-research-coordinator")
    expect(coordinator?.hidden).toBe(true)
    expect(coordinator?.defaultExecution).toBe("background")
    expect(coordinator?.delegationAllowlist).toEqual(["researcher"])
    expect(AgentPreset.get("researcher")?.delegationAllowlist).toBeUndefined()
  })
})
