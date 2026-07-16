import type { Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildMessageTimelineContext } from "./message-timeline-context"
import { buildTimelineTurnLookup } from "./message-timeline-turns"

export function buildMessageTimelineModel(input: {
  messages: MessageType[]
  renderedUsers: UserMessage[]
  partsByMessageID: Record<string, Part[] | undefined>
  sessionCompacting?: number
}) {
  const context = buildMessageTimelineContext(input)

  return {
    context,
    turnLookup: buildTimelineTurnLookup(context.fullHistory, context.renderedHistory),
    attributes: {
      compactionState: context.compactionState,
      activeContextBoundaryID: context.activeContextBoundary?.messageID,
      activeContextBoundaryKind: context.activeContextBoundary?.kind,
    },
  }
}
