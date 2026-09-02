import { describe, expect, test } from "bun:test"
import { nextVisitedSettingsTabs, shouldMountSettingsPanel, type SettingsTab } from "./dialog-settings-logic"

describe("dialog settings loading logic", () => {
  test("marks a newly visited tab without mutating previous set", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts"])
    const next = nextVisitedSettingsTabs(current, "research")

    expect([...current]).toEqual(["general", "shortcuts"])
    expect([...next]).toEqual(["general", "shortcuts", "research"])
    expect(next).not.toBe(current)
  })

  test("reuses the same set when the tab was already visited", () => {
    const current = new Set<SettingsTab>(["general", "shortcuts", "skills"])
    const next = nextVisitedSettingsTabs(current, "skills")

    expect(next).toBe(current)
  })

  test("mounts the current tab and visited lightweight tabs only", () => {
    const visited = new Set<SettingsTab>(["browser", "mcp", "personalization", "appControl", "research", "models", "usage"])

    expect(shouldMountSettingsPanel({ tab: "general", selected: "models", visited })).toBe(false)
    expect(shouldMountSettingsPanel({ tab: "shortcuts", selected: "models", visited })).toBe(false)
    expect(shouldMountSettingsPanel({ tab: "personalization", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "appControl", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "browser", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "research", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "mcp", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "models", selected: "models", visited })).toBe(true)
    expect(shouldMountSettingsPanel({ tab: "models", selected: "usage", visited })).toBe(false)
    expect(shouldMountSettingsPanel({ tab: "usage", selected: "models", visited })).toBe(false)
    expect(shouldMountSettingsPanel({ tab: "usage", selected: "usage", visited })).toBe(true)
  })
})
