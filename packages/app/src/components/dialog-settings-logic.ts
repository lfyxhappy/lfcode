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

const unmountOnTabChange = new Set<SettingsTab>(["models", "plugins", "skills", "automation", "usage"])

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
  if (unmountOnTabChange.has(input.tab)) return input.selected === input.tab
  return input.visited.has(input.tab) || input.selected === input.tab
}
