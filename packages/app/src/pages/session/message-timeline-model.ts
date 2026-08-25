import type { Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildMessageTimelineContext } from "./message-timeline-context"
import { buildTimelineTurnLookup } from "./message-timeline-turns"

export function sameTimelinePartStructure(
  left: Record<string, Part[] | undefined>,
  right: Record<string, Part[] | undefined>,
) {
  const leftIDs = Object.keys(left)
  const rightIDs = Object.keys(right)
  if (leftIDs.length !== rightIDs.length) return false

  for (const messageID of leftIDs) {
    if (!(messageID in right)) return false
    const previous = left[messageID] ?? []
    const next = right[messageID] ?? []
    if (previous.length !== next.length) return false
    for (const [index, part] of previous.entries()) {
      const candidate = next[index]
      if (!candidate || part.type !== candidate.type) return false
      if (part.type !== "text" || candidate.type !== "text") continue
      if (Boolean(part.synthetic) !== Boolean(candidate.synthetic)) return false
      if (Boolean(part.text.trim()) !== Boolean(candidate.text.trim())) return false
    }
  }

  return true
}

export function buildMessageTimelineModel(input: {
  messages: MessageType[]
  renderedUsers: UserMessage[]
  partsByMessageID: Record<string, Part[] | undefined>
  sessionCompacting?: number
}) {
  const context = buildMessageTimelineContext(input)

  return {
    context,
    turnLookup: buildTimelineTurnLookup(context.fullHistory, context.renderedHistory, input.partsByMessageID),
    attributes: {
      compactionState: context.compactionState,
      activeContextBoundaryID: context.activeContextBoundary?.messageID,
      activeContextBoundaryKind: context.activeContextBoundary?.kind,
    },
  }
}
