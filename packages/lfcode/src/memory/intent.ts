import type { MessageV2 } from "@/session/message-v2"

const explicitMemoryRequest = [
  /(?:查|查看|搜索|检索|读取|翻|找|回顾|回忆|调取)(?:一下|下)?(?:之前(?:保存的)?|已保存的|保存的|历史)?(?:记忆|memory)(?:\b|$)/i,
  /(?:回忆|回顾|复述|找回)(?:一下|下)?(?:之前|过去|上次|历史).{0,24}(?:约定|决定|内容|记录|对话)/i,
  /\b(?:search|look up|retrieve|recall|read|inspect|show|use)\s+(?:the\s+)?(?:saved\s+|persistent\s+)?memory\b/i,
  /\bmemory\s+(?:search|lookup|recall)\b/i,
]

export function isExplicitMemoryRequestText(text: string) {
  return explicitMemoryRequest.some((pattern) => pattern.test(text))
}

export function isExplicitMemoryRequest(messages: MessageV2.WithParts[]) {
  const user = messages.findLast(
    (message) =>
      message.info.role === "user" &&
      message.parts.some((part) => part.type !== "text" || (!part.synthetic && !part.ignored)),
  )
  if (!user) return false
  const text = user.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n")
  return isExplicitMemoryRequestText(text)
}
