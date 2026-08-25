import type { AssistantMessage, Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"

export type TimelineTurn = {
  message: UserMessage
  assistantMessages: AssistantMessage[]
}

export function isShellProcessNotice(
  message: MessageType,
  partsByMessageID: Record<string, Part[] | undefined>,
) {
  if (message.role !== "user") return false
  const parts = partsByMessageID[message.id] ?? []
  const text = parts.filter((part) => part.type === "text")
  return (
    text.length > 0 &&
    text.every((part) => part.synthetic && /^Shell process(?:es)? (?:completed|failed|cancelled|reminder|updates)(?::|\b)/.test(part.text))
  )
}

export function isRealUserMessage(message: MessageType, partsByMessageID: Record<string, Part[] | undefined>) {
  if (message.role !== "user") return false
  const parts = partsByMessageID[message.id]
  if (!parts?.length) return true
  return parts.some((part) => part.type !== "text" || !part.synthetic)
}

export function buildTimelineTurnLookup(
  messages: MessageType[],
  users?: UserMessage[],
  partsByMessageID: Record<string, Part[] | undefined> = {},
) {
  const turns = new Map<string, TimelineTurn>()
  const sourceUsers = (users ?? (messages.filter((message) => message.role === "user") as UserMessage[])).filter((message) =>
    isRealUserMessage(message, partsByMessageID),
  )
  const targetUserIDs = new Set(sourceUsers.map((message) => message.id))
  const latestUserID = sourceUsers.at(-1)?.id
  const parentUserID = new Map<string, string>()
  let currentUserID: string | undefined
  let pendingParentID: string | undefined

  for (const message of sourceUsers) {
    turns.set(message.id, {
      message,
      assistantMessages: [],
    })
  }

  for (const message of messages) {
    if (message.role === "user") {
      if (!isRealUserMessage(message, partsByMessageID)) {
        if (currentUserID) parentUserID.set(message.id, currentUserID)
        continue
      }
      currentUserID = message.id
      parentUserID.set(message.id, message.id)
      continue
    }
    if (message.role !== "assistant") continue
    const parentID = message.parentID ? (parentUserID.get(message.parentID) ?? message.parentID) : undefined
    if (typeof message.time.completed !== "number") pendingParentID = parentID
    if (!parentID || !targetUserIDs.has(parentID)) continue
    turns.get(parentID)?.assistantMessages.push(message)
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
