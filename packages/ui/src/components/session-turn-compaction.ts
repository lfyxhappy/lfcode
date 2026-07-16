import type { Message, Part, Session } from "@lfcode-ai/sdk/v2/client"

export type SessionTurnCompactionState = "idle" | "compacting" | "compacted" | "failed"

function hasVisibleAssistantSummary(parts: Part[]) {
  return parts.some((part) => part.type === "text" && !!part.text.trim())
}

export function getSessionTurnCompactionState(input: {
  session?: Session
  message?: Message
  latestBoundaryMessageID?: string
  parts?: Part[]
  assistantMessageCount: number
  assistantParts: Part[]
}) {
  const message = input.message
  if (!message || message.role !== "user") return "idle" satisfies SessionTurnCompactionState

  const boundary = input.parts?.find((part) => part.type === "compaction" || part.type === "checkpoint")
  if (!boundary || boundary.type !== "compaction") return "idle" satisfies SessionTurnCompactionState

  if (hasVisibleAssistantSummary(input.assistantParts)) return "compacted" satisfies SessionTurnCompactionState

  if (input.session?.time.compacting && input.latestBoundaryMessageID === message.id) {
    return "compacting" satisfies SessionTurnCompactionState
  }

  if (input.assistantMessageCount > 0) return "failed" satisfies SessionTurnCompactionState
  return "idle" satisfies SessionTurnCompactionState
}
