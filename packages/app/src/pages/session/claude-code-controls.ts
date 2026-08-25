// Claude's native Shift+Tab cycle is ordered from the current mode to the
// next mode as: bypass → auto → manual → accept edits → plan → bypass.
// Keep this separate from the menu order so labels remain user-friendly while
// the number of native key presses always matches Claude's actual state.
export const CLAUDE_PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const
const CLAUDE_PERMISSION_CYCLE = ["bypassPermissions", "auto", "default", "acceptEdits", "plan"] as const
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number]

export const CLAUDE_CODE_CONTROLS = [
  { id: "permission-default", group: "permissions", kind: "key", icon: "shield", labelKey: "claudeCode.permission.default", shortcut: "Shift+Tab", data: "\u001b[Z", permissionMode: "default" },
  { id: "permission-accept-edits", group: "permissions", kind: "key", icon: "shield", labelKey: "claudeCode.permission.acceptEdits", shortcut: "Shift+Tab", data: "\u001b[Z", permissionMode: "acceptEdits" },
  { id: "permission-plan", group: "permissions", kind: "key", icon: "shield", labelKey: "claudeCode.permission.plan", shortcut: "Shift+Tab", data: "\u001b[Z", permissionMode: "plan" },
  { id: "permission-auto", group: "permissions", kind: "key", icon: "shield", labelKey: "claudeCode.permission.auto", shortcut: "Shift+Tab", data: "\u001b[Z", permissionMode: "auto" },
  { id: "permission-bypass", group: "permissions", kind: "key", icon: "shield", labelKey: "claudeCode.permission.bypass", shortcut: "Shift+Tab", data: "\u001b[Z", permissionMode: "bypassPermissions" },
] as const

export function permissionModeFromScreen(screen: string[]) {
  const text = screen.join(" ").toLowerCase().replace(/\s+/g, " ")
  if (text.includes("bypass permissions on")) return "bypassPermissions" as const
  if (text.includes("auto mode on")) return "auto" as const
  if (text.includes("accept edits on")) return "acceptEdits" as const
  if (text.includes("plan mode on") || text.includes("plan permissions on")) return "plan" as const
  if (text.includes("manual mode on") || text.includes("default permissions on") || text.includes("permissions on")) return "default" as const
  return undefined
}

export function permissionCycleData(current: ClaudePermissionMode | undefined, target: ClaudePermissionMode) {
  if (!current) return ""
  const from = CLAUDE_PERMISSION_CYCLE.indexOf(current)
  const to = CLAUDE_PERMISSION_CYCLE.indexOf(target)
  if (from < 0 || to < 0) return ""
  const count = (to - from + CLAUDE_PERMISSION_CYCLE.length) % CLAUDE_PERMISSION_CYCLE.length
  return "\u001b[Z".repeat(count)
}

export function claudeCodeControlData(id: string) {
  return CLAUDE_CODE_CONTROLS.find((control) => control.id === id)?.data
}
