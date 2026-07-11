import type { VirtualizerHandle } from "virtua/solid"
import { acquireSessionCacheLease } from "@/context/session-cache-lease"

type Entry = {
  cache: VirtualizerHandle["cache"]
  turns: string
  revision: string
  usedAt: number
  releaseLease: () => void
}

const MAX_CACHES = 8
const caches = new Map<string, Entry>()
let hits = 0
let misses = 0

function turnSignature(turnIDs: string[]) {
  return turnIDs.join("\u0000")
}

/**
 * Keeps only virtual measurements for recently visited timelines. A cache is
 * reusable only when the virtual item identity is unchanged; it never stores
 * DOM, a native selection, or a serialized scroll offset.
 */
export function rememberSessionVirtualCache(input: {
  key: string
  sessionID: string
  turnIDs: string[]
  revision: string
  cache: VirtualizerHandle["cache"]
}) {
  dropSessionVirtualCache(input.key)
  caches.set(input.key, {
    cache: input.cache,
    turns: turnSignature(input.turnIDs),
    revision: input.revision,
    usedAt: Date.now(),
    releaseLease: acquireSessionCacheLease({ sessionID: input.sessionID, owner: `virtual:${input.key}` }),
  })
  trim()
}

export function readSessionVirtualCache(input: { key: string; turnIDs: string[]; revision: string }) {
  const entry = caches.get(input.key)
  if (!entry || entry.turns !== turnSignature(input.turnIDs) || entry.revision !== input.revision) {
    misses += 1
    return
  }
  hits += 1
  entry.usedAt = Date.now()
  return entry.cache
}

export function dropSessionVirtualCache(key: string) {
  caches.get(key)?.releaseLease()
  caches.delete(key)
}

export function sessionVirtualCacheDiagnostics() {
  return {
    hits,
    misses,
    entries: [...caches.entries()].map(([key, entry]) => ({
      key,
      turns: entry.turns ? entry.turns.split("\u0000").length : 0,
      usedAt: entry.usedAt,
    })),
  }
}

export function clearSessionVirtualCaches() {
  for (const key of caches.keys()) dropSessionVirtualCache(key)
  hits = 0
  misses = 0
}

export function coolSessionVirtualCaches(input?: { max?: number }) {
  const max = input?.max ?? 0
  if (caches.size <= max) return
  const expired = [...caches.entries()]
    .sort(([, left], [, right]) => left.usedAt - right.usedAt)
    .slice(0, Math.max(0, caches.size - max))
  for (const [key] of expired) dropSessionVirtualCache(key)
}

function trim() {
  if (caches.size <= MAX_CACHES) return
  const oldest = [...caches.entries()].sort(([, left], [, right]) => left.usedAt - right.usedAt)[0]?.[0]
  if (oldest) dropSessionVirtualCache(oldest)
}
