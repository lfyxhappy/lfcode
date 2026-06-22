export type SettingsTab =
  | "general"
  | "shortcuts"
  | "browser"
  | "archives"
  | "providers"
  | "models"
  | "mcp"
  | "skills"
  | "usage"

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
  return input.tab === "general" || input.tab === "shortcuts" || input.visited.has(input.tab) || input.selected === input.tab
}
