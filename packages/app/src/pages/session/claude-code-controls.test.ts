import { expect, test } from "bun:test"
import { claudeCodeControlData, permissionCycleData, permissionModeFromScreen } from "./claude-code-controls"

test("maps Claude Code controls to documented native key sequences", () => {
  expect(claudeCodeControlData("permission-default")).toBe("\u001b[Z")
  expect(claudeCodeControlData("permission-bypass")).toBe("\u001b[Z")
})

test("does not expose an unknown control", () => {
  expect(claudeCodeControlData("unknown")).toBeUndefined()
})

test("reads Claude's permission mode from the native status line", () => {
  expect(permissionModeFromScreen(["bypass permissions on (shift+tab to cycle)"])).toBe("bypassPermissions")
  expect(permissionModeFromScreen(["auto mode on (shift+tab to cycle)"])).toBe("auto")
  expect(permissionModeFromScreen(["manual mode on · ? for shortcuts"])).toBe("default")
  expect(permissionModeFromScreen(["accept edits on"])).toBe("acceptEdits")
})

test("cycles from the current permission mode to the selected mode", () => {
  expect(permissionCycleData("bypassPermissions", "auto")).toBe("\u001b[Z")
  expect(permissionCycleData("bypassPermissions", "default")).toBe("\u001b[Z\u001b[Z")
  expect(permissionCycleData("default", "plan")).toBe("\u001b[Z\u001b[Z")
  expect(permissionCycleData(undefined, "plan")).toBe("")
})
