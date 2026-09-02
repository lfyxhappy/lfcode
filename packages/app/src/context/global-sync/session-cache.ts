import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@lfcode-ai/sdk/v2/client"
import type { HookRunActivity, SessionActivity, SessionGoal } from "./types"
import {
  dropInlineImageCacheForParts,
  dropInlineImageCacheForSessions,
  INLINE_IMAGE_CACHE_PREFIX,
  peekInlineImageUrlByKey,
} from "@lfcode-ai/ui/inline-image-cache"
import { filterUnleasedSessionCaches } from "@/context/session-cache-lease"

export const SESSION_CACHE_LIMIT = 96
export const SESSION_MESSAGE_CACHE_LIMIT = 5_000
export const SESSION_PART_CACHE_LIMIT = 20_000
export const SESSION_CACHE_BYTES_LIMIT = 64 * 1024 * 1024

type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_goal?: Record<string, SessionGoal | undefined>
  hook_run?: Record<string, HookRunActivity[] | undefined>
  activity?: Record<string, SessionActivity[] | undefined>
  session_diff: Record<string, SnapshotFileDiff[] | undefined>
  todo: Record<string, Todo[] | undefined>
  message: Record<string, Message[] | undefined>
  messageByAgent?: Record<string, Record<string, Message[] | undefined> | undefined>
  actor?: Record<
    string,
    {
      actorID: string
      sessionID: string
      mode: string
      status: string
      description: string
      time: { created: number }
      agent?: string
      parentActorID?: string
    }[]
    | undefined
  >
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(filterUnleasedSessionCaches(Array.from(sessionIDs).filter(Boolean)))
  if (stale.size === 0) return
  dropInlineImageCacheForSessions(stale)

  const orphaned = new Set<string>()

  for (const sessionID of stale) {
    for (const message of store.message[sessionID] ?? []) {
      const parts = store.part[message.id]
      if (!parts) continue
      dropInlineImageCacheForParts(parts)
      delete store.part[message.id]
    }
    if ((store.message[sessionID] ?? []).length === 0) {
      orphaned.add(sessionID)
    }
    delete store.message[sessionID]
    if (store.messageByAgent) delete store.messageByAgent[sessionID]
    if (store.actor) delete store.actor[sessionID]
    delete store.todo[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    if (store.session_goal) delete store.session_goal[sessionID]
    if (store.hook_run) delete store.hook_run[sessionID]
    if (store.activity) delete store.activity[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }

  if (orphaned.size === 0) return

  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => orphaned.has(part?.sessionID ?? ""))) continue
    dropInlineImageCacheForParts(parts)
    delete store.part[key]
  }
}

export function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
  preserve?: Iterable<string>
}) {
  const stale: string[] = []
  const keep = new Set([input.keep, ...Array.from(input.preserve ?? [])])
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (keep.has(id)) continue
    stale.push(id)
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}

export function pickOversizedSessionCaches(input: {
  message: Record<string, Message[] | undefined>
  part?: Record<string, Part[] | undefined>
  keep: string
  limit: number
  partLimit?: number
  byteLimit?: number
}) {
  const partBySession = new Map<string, Part[]>()
  for (const parts of Object.values(input.part ?? {})) {
    for (const part of parts ?? []) {
      const list = partBySession.get(part.sessionID) ?? []
      list.push(part)
      partBySession.set(part.sessionID, list)
    }
  }

  return [...new Set([
    ...Object.keys(input.message),
    ...partBySession.keys(),
  ])].filter((sessionID) => {
    if (sessionID === input.keep) return false
    const messages = input.message[sessionID]
    const parts = partBySession.get(sessionID)
    return (
      (messages?.length ?? 0) > input.limit ||
      (parts?.length ?? 0) > (input.partLimit ?? SESSION_PART_CACHE_LIMIT) ||
      estimateSessionCacheBytes(messages, parts) > (input.byteLimit ?? SESSION_CACHE_BYTES_LIMIT)
    )
  })
}

export function estimateSessionCacheBytes(messages: Message[] | undefined, parts: Part[] | undefined) {
  const messageBytes = messages?.reduce((sum, message) => sum + estimateValueBytes(message), 0) ?? 0
  const partBytes = parts?.reduce((sum, part) => sum + estimatePartBytes(part), 0) ?? 0
  return messageBytes + partBytes
}

function estimatePartBytes(part: Part) {
  const resolvedUrl =
    "url" in part && typeof part.url === "string"
      ? part.url.startsWith(INLINE_IMAGE_CACHE_PREFIX)
        ? peekInlineImageUrlByKey(part.url.slice(INLINE_IMAGE_CACHE_PREFIX.length)) ?? part.url
        : part.url
      : undefined
  return estimateValueBytes({
    ...part,
    ...(resolvedUrl ? { url: resolvedUrl } : {}),
  })
}

function estimateValueBytes(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value === "string") return value.length * 2
  if (typeof value === "number" || typeof value === "boolean") return String(value).length * 2
  if (typeof value === "bigint") return value.toString().length * 2
  if (typeof value === "function" || typeof value === "symbol") return 0
  if (value === null) return 8
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateValueBytes(item), 2)
  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [key, entry]) => sum + key.length * 2 + estimateValueBytes(entry),
    2,
  )
}
