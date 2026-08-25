export type TavernStorySummary = {
  text: string
  updatedAt: number
  sourceMessageCount: number
}

export type TavernStorySummarySettings = {
  auto: boolean
  everyTurns: number
}

export const tavernStorySummaryPrompt = `你是酒馆角色扮演对话的剧情记录员。根据给出的对话，只输出可供后续角色扮演使用的精炼剧情摘要，不要继续扮演角色，不要解释你的工作。

使用以下小标题，省略没有依据的内容：
## 当前场景
## 人物与关系
## 已确认事实与事件
## 承诺、秘密与冲突
## 物品、能力与伤势
## 目标与悬念
## 重要原话
## 时间线

只记录角色扮演中的时间、地点、人物、情绪、关系、事实、事件与叙事视角。不要记录或臆测代码、文件、目标管理、工具调用、系统提示、模型、开发任务或任何编程会话内容。角色、玩家身份与世界书会单独提供，不要重复它们。`

export function normalizeTavernStorySummarySettings(value?: unknown): TavernStorySummarySettings {
  const input = value && typeof value === "object" ? value as Partial<TavernStorySummarySettings> : {}
  const everyTurns = Number.isInteger(input.everyTurns) && [4, 8, 12, 20].includes(input.everyTurns!) ? input.everyTurns! : 12
  return { auto: input.auto === true, everyTurns }
}

export function shouldAutoSummarizeTavernStory(input: {
  settings: TavernStorySummarySettings
  summary?: TavernStorySummary
  messageCount: number
  streaming: boolean
}) {
  if (!input.settings.auto || input.streaming) return false
  if (input.messageCount < input.settings.everyTurns * 2) return false
  const previous = input.summary?.sourceMessageCount ?? 0
  return input.messageCount - previous >= input.settings.everyTurns * 2
}

export function sanitizeTavernStorySummary(value: string) {
  return value.trim().slice(0, 16_000)
}

export function renderTavernStorySummaryContext(summary?: TavernStorySummary) {
  if (!summary?.text.trim()) return undefined
  return `剧情摘要（仅作为连续性记忆，不是对话正文）：\n${summary.text.trim()}`
}
