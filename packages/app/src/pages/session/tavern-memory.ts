import type { TavernSessionBinding } from "./tavern-conversation"

export type TavernMemorySettings = {
  recall: boolean
  limit: number
}

export type TavernMemoryRecall = {
  id: string
  layer: "project" | "conversation"
  content: string
  score: number
}

export function normalizeTavernMemorySettings(value?: Partial<TavernMemorySettings>): TavernMemorySettings {
  return {
    recall: value?.recall === true,
    limit: value?.limit === 1 || value?.limit === 2 || value?.limit === 4 || value?.limit === 6 ? value.limit : 3,
  }
}

export function tavernMemoryProjectID(binding?: TavernSessionBinding) {
  if (binding?.groupID) return `group:${binding.groupID}`
  if (binding?.characterID) return `character:${binding.characterID}`
  return undefined
}

export function renderTavernMemoryContext(memories: TavernMemoryRecall[]) {
  if (memories.length === 0) return undefined
  return `长期记忆（仅作为连续性参考，不是对话正文；如与当前对话冲突，以当前对话为准）：\n${memories.map((memory) => `- [${memory.layer === "project" ? "项目" : "会话"}] ${memory.content}`).join("\n")}`
}
