export type KeybindGroup = "General" | "Session" | "Navigation" | "Model and agent" | "Terminal" | "Prompt" | "Browser"

export type KeybindMeta = {
  title: string
  group: KeybindGroup
  priority: number
}

const PALETTE_ID = "command.palette"

const FEATURED_IDS = [
  PALETTE_ID,
  "settings.open",
  "session.new",
  "input.focus",
  "model.choose",
  "agent.cycle",
  "terminal.toggle",
  "browser.open",
]

export const KEYBIND_GROUPS: KeybindGroup[] = [
  "General",
  "Session",
  "Navigation",
  "Model and agent",
  "Terminal",
  "Prompt",
  "Browser",
]

export function groupFor(id: string): KeybindGroup {
  if (id === PALETTE_ID) return "General"
  if (id.startsWith("browser.")) return "Browser"
  if (id.startsWith("terminal.")) return "Terminal"
  if (id.startsWith("model.") || id.startsWith("agent.") || id.startsWith("mcp.")) return "Model and agent"
  if (id.startsWith("file.") || id.startsWith("fileTree.")) return "Navigation"
  if (id.startsWith("prompt.")) return "Prompt"
  if (
    id.startsWith("session.") ||
    id.startsWith("message.") ||
    id.startsWith("permissions.") ||
    id.startsWith("steps.") ||
    id.startsWith("review.")
  )
    return "Session"

  return "General"
}

export function priorityFor(id: string) {
  const index = FEATURED_IDS.indexOf(id)
  return index === -1 ? FEATURED_IDS.length : index
}

export function groupedFor(list: Map<string, KeybindMeta>, keybind: (id: string) => string | undefined) {
  const out = new Map<KeybindGroup, string[]>()
  for (const group of KEYBIND_GROUPS) out.set(group, [])

  for (const [id, item] of list) {
    const ids = out.get(item.group)
    if (!ids) continue
    ids.push(id)
  }

  for (const group of KEYBIND_GROUPS) {
    const ids = out.get(group)
    if (!ids) continue
    ids.sort((a, b) => {
      const aMeta = list.get(a)
      const bMeta = list.get(b)
      if (aMeta?.priority !== bMeta?.priority) return (aMeta?.priority ?? Infinity) - (bMeta?.priority ?? Infinity)

      const aAssigned = !!keybind(a)
      const bAssigned = !!keybind(b)
      if (aAssigned !== bAssigned) return aAssigned ? -1 : 1

      return (aMeta?.title ?? "").localeCompare(bMeta?.title ?? "")
    })
  }

  return out
}

export function featuredFor(list: Map<string, KeybindMeta>) {
  return FEATURED_IDS.filter((id) => list.has(id))
}
