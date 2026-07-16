import { describe, expect, test } from "bun:test"
import { nextVisitedSettingsTabs, shouldMountSettingsPanel, type SettingsTab } from "./dialog-settings-logic"

describe("dialog settings loading logic", () => {
  test("marks a newly visited tab without mutating previous set", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts"])
    const next = nextVisitedSettingsTabs(current, "personalization")

    expect([...current]).toEqual(["general", "shortcuts"])
    expect([...next]).toEqual(["general", "shortcuts", "personalization"])
    expect(next).not.toBe(current)
  })

  test("reuses the same set when the tab was already visited", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts", "skills"])
    const next = nextVisitedSettingsTabs(current, "skills")

    expect(next).toBe(current)
  })

  test("mounts eager tabs, current tab, and visited lazy tabs only", () => {
    const visited = new Set<SettingsTab>(["general", "shortcuts", "browser", "mcp", "personalization", "appControl", "runtimes"])

    expect(shouldMountSettingsPanel({ tab: "general", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "shortcuts", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "personalization", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "appControl", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "browser", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "runtimes", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "mcp", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "models", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "usage", selected: "models", visited })).toBe(false)
  })
})
