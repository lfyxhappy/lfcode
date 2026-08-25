export type TavernQuickReply = { id: string; label: string; title?: string; message: string; append: boolean }
export type TavernQuickReplySet = { id: string; name: string; replies: TavernQuickReply[] }

export function findTavernQuickReply(sets: TavernQuickReplySet[], value: string) {
  const [setID, replyID] = value.split(":", 2)
  return sets.find((set) => set.id === setID)?.replies.find((reply) => reply.id === replyID)
}

export function insertTavernQuickReply(draft: string, reply: TavernQuickReply) {
  if (!reply.append || !draft.trim()) return reply.message
  return `${draft.trimEnd()}\n${reply.message}`
}
