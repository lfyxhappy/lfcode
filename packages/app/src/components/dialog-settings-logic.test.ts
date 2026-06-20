import { describe, expect, test } from "bun:test"
import { nextVisitedSettingsTabs, shouldMountSettingsPanel, type SettingsTab } from "./dialog-settings-logic"

describe("dialog settings loading logic", () => {
  test("marks a newly visited tab without mutating previous set", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts"])
    const next = nextVisitedSettingsTabs(current, "mcp")

    expect([...current]).toEqual(["general", "shortcuts"])
    expect([...next]).toEqual(["general", "shortcuts", "mcp"])
    expect(next).not.toBe(current)
  })

  test("reuses the same set when the tab was already visited", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts", "skills"])
    const next = nextVisitedSettingsTabs(current, "skills")

    expect(next).toBe(current)
  })

  test("mounts eager tabs, current tab, and visited lazy tabs only", () => {
    const visited = new Set<SettingsTab>(["general", "shortcuts", "mcp"])

    expect(shouldMountSettingsPanel({ tab: "general", selected: "providers", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "shortcuts", selected: "providers", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "mcp", selected: "providers", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "providers", selected: "providers", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "usage", selected: "providers", visited })).toBe(false)
  })
})
