import type { AssistantMessage, Message as MessageType, UserMessage } from "@lfcode-ai/sdk/v2"

export type TimelineTurn = {
  message: UserMessage
  assistantMessages: AssistantMessage[]
}

export function buildTimelineTurnLookup(messages: MessageType[], users?: UserMessage[]) {
  const turns = new Map<string, TimelineTurn>()
  const sourceUsers = users ?? (messages.filter((message) => message.role === "user") as UserMessage[])
  const targetUserIDs = new Set(sourceUsers.map((message) => message.id))
  const latestUserID = sourceUsers.at(-1)?.id
  let pendingParentID: string | undefined

  for (const message of sourceUsers) {
    turns.set(message.id, {
      message,
      assistantMessages: [],
    })
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    if (typeof message.time.completed !== "number") pendingParentID = message.parentID
    if (!message.parentID || !targetUserIDs.has(message.parentID)) continue
    turns.get(message.parentID)?.assistantMessages.push(message)
  }

  const activeMessageID =
    pendingParentID && turns.has(pendingParentID)
      ? pendingParentID
      : pendingParentID
        ? latestUserID
        : undefined

  return {
    turns,
    activeMessageID,
  }
}
