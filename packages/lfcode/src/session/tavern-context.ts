import type { ModelMessage } from "ai"

export type TavernContext = {
  depth: { content: string; depth: number }[]
}

export function insertTavernContext(messages: ModelMessage[], context?: TavernContext) {
  if (!context?.depth.length) return messages
  const positions = context.depth.reduce((result, entry) => {
    const position = Math.max(0, messages.length - entry.depth)
    const entries = result.get(position) ?? []
    entries.push(entry)
    result.set(position, entries)
    return result
  }, new Map<number, TavernContext["depth"]>())
  return messages.flatMap((message, index) => [
    ...(positions.get(index) ?? []).map((entry): ModelMessage => ({
      role: "system",
      content: `世界书（历史深度 ${entry.depth}）：\n${entry.content}`,
    })),
    message,
  ]).concat((positions.get(messages.length) ?? []).map((entry): ModelMessage => ({
    role: "system",
    content: `世界书（历史深度 ${entry.depth}）：\n${entry.content}`,
  })))
}
