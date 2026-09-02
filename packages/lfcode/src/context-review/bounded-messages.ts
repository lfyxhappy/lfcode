import type { MessageV2 } from "@/session/message-v2"
import type { MessageID } from "@/session/schema"

const MAX_REVIEW_MESSAGES = 24

/**
 * Context review is advisory work. Keep it on the primary conversation's
 * bounded slice so child-agent transcripts and unbounded tool output cannot
 * consume a second full request while the main turn is already complete.
 */
export function boundedContextReviewMessages(
  messages: MessageV2.WithParts[],
  sourceUserMessageID: MessageID,
  sourceAssistantMessageID: MessageID,
) {
  const primary = messages.filter(
    (message) =>
      (message.info.agentID === undefined || message.info.agentID === "main") &&
      (message.info.role === "user" || message.info.role === "assistant"),
  )
  const recent = primary.slice(-MAX_REVIEW_MESSAGES)
  const required = [
    primary.find((message) => message.info.id === sourceUserMessageID),
    primary.find((message) => message.info.id === sourceAssistantMessageID),
  ].filter((message): message is MessageV2.WithParts => message !== undefined)
  const selected = new Set([...recent, ...required].map((message) => message.info.id))
  return primary.filter((message) => selected.has(message.info.id))
}
