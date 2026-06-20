export type SkillMode = "browse" | "manage"

export type SkillImportSource = "zip" | "folder" | "claude" | "codex" | "agents"

export type LocalSkillItem = {
  directory?: string
  name: string
  description: string
  location: string
  content: string
  hidden?: boolean
}

export const skillImportSources = [
  { value: "zip", label: "settings.skills.import.zip" },
  { value: "folder", label: "settings.skills.import.folder" },
  { value: "claude", label: "settings.skills.import.claude" },
  { value: "codex", label: "settings.skills.import.codex" },
  { value: "agents", label: "settings.skills.import.agents" },
] as const satisfies ReadonlyArray<{ value: SkillImportSource; label: string }>

export function localSkillKey(skill: LocalSkillItem) {
  return skill.directory ?? skill.location
}

export function localSkillDirectory(skill: LocalSkillItem) {
  return skill.directory ?? skill.location.replace(/[/\\]SKILL\.md$/, "")
}

export function replaceLocalSkill(items: LocalSkillItem[], next: LocalSkillItem) {
  const key = localSkillKey(next)
  const current = items.filter((item) => localSkillKey(item) !== key)
  return [...current, next].toSorted((a, b) => localSkillKey(a).localeCompare(localSkillKey(b)))
}

export function removeLocalSkill(items: LocalSkillItem[], directory: string) {
  return items.filter((item) => localSkillKey(item) !== directory)
}
