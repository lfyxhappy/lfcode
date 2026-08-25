export type SettingsTab =
  | "general"
  | "editor"
  | "personalization"
  | "appControl"
  | "lanAccess"
  | "shortcuts"
  | "browser"
  | "research"
  | "automation"
  | "archives"
  | "models"
  | "mcp"
  | "plugins"
  | "skills"
  | "agents"
  | "hooks"
  | "usage"
  | "agentOS"

export function nextVisitedSettingsTabs(current: Set<SettingsTab>, tab: SettingsTab) {
  if (current.has(tab)) return current
  const next = new Set(current)
  next.add(tab)
  return next
}

export function shouldMountSettingsPanel(input: {
  tab: SettingsTab
  selected: SettingsTab
  visited: Set<SettingsTab>
}) {
  return input.visited.has(input.tab) || input.selected === input.tab
}
