export type TavernRoadwaySettings = {
  enabled: boolean
  autoTrigger: boolean
  autoOpen: boolean
  showUseAction: boolean
  autoSubmitUseAction: boolean
  extractionStrategy: "bullet" | "none"
  messageRole: "system" | "user" | "assistant"
  maxContextMessages: number
  maxOutputTokens: number
  prompt: string
  impersonatePrompt: string
  modelSource: "session" | "custom"
  model?: { providerID: string; modelID: string }
}

export type TavernRoadwayResult = {
  targetMessageID: string
  text: string
  options?: string[]
  expanded?: boolean
  createdAt: number
}

export const ROADWAY_DEFAULT_PROMPT = `你是一个 AI 剧情脑暴助手，负责在延续当前对话既有上下文的前提下，帮助玩家创造更有沉浸感、也更有惊喜感的角色扮演体验。

根据当前角色设定、世界背景和局面，生成 6 条玩家接下来可以采取的行动建议。每一项都必须是清晰、可执行、简洁并且有创意的纯文本句子，使用编号列表输出。

尽量覆盖观察调查、对话说服、潜行周旋、冲突对抗、制作修理、知识探索、移动探索、欺骗操纵、表演娱乐和技术操作等不同方向。避免重复、明显或与既有人设和世界观冲突的行动，不要输出寒暄、解释或剧情正文。`

export const ROADWAY_DEFAULT_IMPERSONATE = `请以玩家的身份，把下面选中的行动改写成适合当前酒馆对话的第一人称回复。只输出玩家的说话和行动，不要替角色说话，不要解释过程。

选中的行动：
{{roadwaySelected}}`

export const defaultRoadwaySettings = (): TavernRoadwaySettings => ({
  enabled: true,
  autoTrigger: false,
  autoOpen: true,
  showUseAction: true,
  autoSubmitUseAction: false,
  extractionStrategy: "bullet",
  messageRole: "system",
  maxContextMessages: 40,
  maxOutputTokens: 500,
  prompt: ROADWAY_DEFAULT_PROMPT,
  impersonatePrompt: ROADWAY_DEFAULT_IMPERSONATE,
  modelSource: "session",
})

export function normalizeRoadwaySettings(value: unknown): TavernRoadwaySettings {
  const defaults = defaultRoadwaySettings()
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults
  const input = value as Partial<TavernRoadwaySettings>
  return {
    ...defaults,
    ...input,
    extractionStrategy: input.extractionStrategy === "none" ? "none" : "bullet",
    messageRole: input.messageRole === "user" || input.messageRole === "assistant" ? input.messageRole : "system",
    modelSource: input.modelSource === "custom" ? "custom" : "session",
    maxContextMessages: clampNumber(input.maxContextMessages, defaults.maxContextMessages, 1, 200),
    maxOutputTokens: clampNumber(input.maxOutputTokens, defaults.maxOutputTokens, 16, 16000),
    model:
      input.model && typeof input.model.providerID === "string" && typeof input.model.modelID === "string"
        ? input.model
        : undefined,
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}
