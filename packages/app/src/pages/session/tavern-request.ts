import { renderTavernAuthorNote } from "./tavern-author-note"
import { renderTavernConversationContext, resolveTavernConversation, type TavernSessionBinding } from "./tavern-conversation"
import { expandTavernMacros } from "./tavern-macros"
import { renderTavernMemoryContext, type TavernMemoryRecall } from "./tavern-memory"
import { renderTavernStorySummaryContext, type TavernStorySummary } from "./tavern-story-summary"
import { renderTavernWorldbookSections, type TavernWorldbook } from "./tavern-worldbook"

export type TavernDepthContext = {
  depth: { content: string; depth: number }[]
}

export function buildTavernRequestContext(input: {
  conversation?: ReturnType<typeof resolveTavernConversation>
  variables?: Record<string, string>
  worldbooks: TavernWorldbook[]
  worldbookIDs: string[]
  storySummary?: TavernStorySummary
  authorNote?: TavernSessionBinding["authorNote"]
  memory: TavernMemoryRecall[]
  openingMessage?: string
  transcript: { role: "user" | "assistant"; text: string }[]
}) {
  const worldbooks = renderTavernWorldbookSections({
    worldbooks: input.worldbooks,
    worldbookIDs: input.worldbookIDs,
    transcript: input.transcript,
  })
  const expand = (value: string) =>
    expandTavernMacros(value, {
      characterName: input.conversation?.speaker?.name,
      userName: input.conversation?.persona?.name,
      variables: input.variables,
    })
  return {
    system: [
      "这是一个酒馆角色扮演对话。保持叙事沉浸感，不要使用编程助手、工具调用、项目文件或任务规划语气。",
      renderTavernWorldbookContext("世界书（角色定义前）", worldbooks.beforeCharacter),
      ...(input.conversation ? renderTavernConversationContext(input.conversation, expand) : []),
      renderTavernWorldbookContext("世界书（角色定义后）", worldbooks.afterCharacter),
      renderTavernWorldbookContext("世界书（示例对话前）", worldbooks.beforeExamples),
      renderTavernWorldbookContext("世界书（示例对话后）", worldbooks.afterExamples),
      renderTavernStorySummaryContext(input.storySummary),
      renderTavernWorldbookContext("世界书（作者注释前）", worldbooks.beforeAuthorNote),
      renderTavernAuthorNote(input.authorNote, expand),
      renderTavernWorldbookContext("世界书（作者注释后）", worldbooks.afterAuthorNote),
      renderTavernMemoryContext(input.memory),
      input.openingMessage ? `本段对话已经以角色的开场白开始，延续其语气和情境：\n${input.openingMessage}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
    tavernContext: worldbooks.depth.length ? { depth: worldbooks.depth } satisfies TavernDepthContext : undefined,
  }
}

function renderTavernWorldbookContext(label: string, entries: string[]) {
  return entries.length ? `${label}：\n${entries.join("\n\n")}` : undefined
}
