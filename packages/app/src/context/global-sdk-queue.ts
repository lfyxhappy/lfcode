import type { Event } from "@lfcode-ai/sdk/v2/client"

export type GlobalSdkQueuedEvent = {
  directory: string
  payload: Event
}

type CoalescedEntry = {
  index: number
  deltaSeq: number
}

const partDeltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`

const queueKey = (directory: string, payload: Event) => {
  if (payload.type === "session.status") return { key: `session.status:${directory}:${payload.properties.sessionID}` }
  if (payload.type === "lsp.updated") return { key: `lsp.updated:${directory}` }
  if (payload.type === "message.part.updated") {
    const part = payload.properties.part
    return {
      key: `message.part.updated:${directory}:${part.messageID}:${part.id}`,
      deltaKey: partDeltaKey(directory, part.messageID, part.id),
    }
  }
}

const deltaKeyForEvent = (directory: string, payload: Event) => {
  if (payload.type !== "message.part.delta") return
  return partDeltaKey(directory, payload.properties.messageID, payload.properties.partID)
}

/**
 * Keep the "create part" updated event ahead of deltas, but once deltas have
 * started for a part in the current frame, stop replacing that earlier event.
 * Later terminal updated events still coalesce with each other.
 */
export function queueGlobalSdkEvent(input: {
  queue: GlobalSdkQueuedEvent[]
  coalesced: Map<string, CoalescedEntry>
  deltaSeq: Map<string, number>
  directory: string
  payload: Event
}) {
  const deltaKey = deltaKeyForEvent(input.directory, input.payload)
  if (deltaKey) {
    input.deltaSeq.set(deltaKey, (input.deltaSeq.get(deltaKey) ?? 0) + 1)
  }

  const keyed = queueKey(input.directory, input.payload)
  if (!keyed) {
    input.queue.push({ directory: input.directory, payload: input.payload })
    return
  }

  const currentDeltaSeq = keyed.deltaKey ? (input.deltaSeq.get(keyed.deltaKey) ?? 0) : 0
  const existing = input.coalesced.get(keyed.key)
  if (existing && existing.deltaSeq === currentDeltaSeq) {
    input.queue[existing.index] = { directory: input.directory, payload: input.payload }
    return
  }

  input.coalesced.set(keyed.key, {
    index: input.queue.length,
    deltaSeq: currentDeltaSeq,
  })
  input.queue.push({ directory: input.directory, payload: input.payload })
}
