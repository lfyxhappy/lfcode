import { IMAGE_THUMBNAIL_MAX_BYTES, estimateDataUrlBytes } from "./image-thumbnail"

export const INLINE_IMAGE_CACHE_PREFIX = "lfcode-inline-image://"
export const INLINE_IMAGE_CACHE_MAX_ENTRIES = 64
export const INLINE_IMAGE_CACHE_MAX_BYTES = 24 * 1024 * 1024

type InlineImagePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  url: string
}

type CacheEntry = {
  sessionID: string
  messageID: string
  partID: string
  url: string
  bytes: number
}

const cache = new Map<string, CacheEntry>()
const sessionIndex = new Map<string, Set<string>>()
let cacheBytes = 0
let cacheLimits = {
  maxEntries: INLINE_IMAGE_CACHE_MAX_ENTRIES,
  maxBytes: INLINE_IMAGE_CACHE_MAX_BYTES,
}

const partKey = (input: { sessionID: string; messageID: string; partID: string }) =>
  `${input.sessionID}\n${input.messageID}\n${input.partID}`

const partKeyFromUrl = (url: string) =>
  url.startsWith(INLINE_IMAGE_CACHE_PREFIX) ? url.slice(INLINE_IMAGE_CACHE_PREFIX.length) : undefined

function indexSession(sessionID: string, key: string) {
  const existing = sessionIndex.get(sessionID)
  if (existing) {
    existing.add(key)
    return
  }
  sessionIndex.set(sessionID, new Set([key]))
}

function entryBytes(url: string) {
  return estimateDataUrlBytes(url) ?? url.length * 2
}

function touchCacheKey(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cache.set(key, entry)
}

function enforceCacheLimits() {
  while (cache.size > cacheLimits.maxEntries || cacheBytes > cacheLimits.maxBytes) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) return
    const entry = cache.get(oldestKey)
    if (!entry) continue
    cache.delete(oldestKey)
    cacheBytes -= entry.bytes
    const indexed = sessionIndex.get(entry.sessionID)
    if (!indexed) continue
    indexed.delete(oldestKey)
    if (indexed.size === 0) sessionIndex.delete(entry.sessionID)
  }
}

function setCacheEntry(key: string, entry: CacheEntry) {
  const previous = cache.get(key)
  if (previous) {
    cacheBytes -= previous.bytes
    cache.delete(key)
  }
  cache.set(key, entry)
  cacheBytes += entry.bytes
  indexSession(entry.sessionID, key)
  enforceCacheLimits()
}

function dropCacheKey(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cacheBytes -= entry.bytes
  const indexed = sessionIndex.get(entry.sessionID)
  if (!indexed) return
  indexed.delete(key)
  if (indexed.size === 0) sessionIndex.delete(entry.sessionID)
}

export function isInlineImageCacheUrl(url: string) {
  return url.startsWith(INLINE_IMAGE_CACHE_PREFIX)
}

export function isOversizedInlineImageDataUrl(url: string, mime: string) {
  if (!mime.startsWith("image/")) return false
  if (!url.startsWith("data:image/")) return false
  const bytes = estimateDataUrlBytes(url)
  if (bytes === undefined) return false
  return bytes > IMAGE_THUMBNAIL_MAX_BYTES
}

export function stashInlineImagePart<T extends InlineImagePart>(part: T): T {
  if (!isOversizedInlineImageDataUrl(part.url, part.mime)) return part
  const key = partKey({ sessionID: part.sessionID, messageID: part.messageID, partID: part.id })
  setCacheEntry(key, {
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
    url: part.url,
    bytes: entryBytes(part.url),
  })
  return { ...part, url: INLINE_IMAGE_CACHE_PREFIX + key }
}

export function resolveInlineImageUrl(input: { sessionID: string; messageID: string; id?: string; partID?: string; url?: string }) {
  const direct = input.url ? partKeyFromUrl(input.url) : undefined
  if (direct) {
    return peekInlineImageUrl(direct)
  }
  const partID = input.partID ?? input.id
  if (!partID) return
  const key = partKey({ sessionID: input.sessionID, messageID: input.messageID, partID })
  return peekInlineImageUrl(key)
}

export function peekInlineImageUrl(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  touchCacheKey(key)
  return entry.url
}

export function peekInlineImageUrlByKey(key: string) {
  return cache.get(key)?.url
}

export function dropInlineImageCacheForParts(
  parts: Array<{ id: string; sessionID: string; messageID: string; type?: string; mime?: string; url?: string }> | undefined,
) {
  if (!parts) return
  for (const part of parts) {
    if (!part?.id || !part.sessionID || !part.messageID) continue
    const fromUrl = part.url ? partKeyFromUrl(part.url) : undefined
    dropCacheKey(fromUrl ?? partKey({ sessionID: part.sessionID, messageID: part.messageID, partID: part.id }))
  }
}

export function dropInlineImageCacheForSessions(sessionIDs: Iterable<string>) {
  for (const sessionID of sessionIDs) {
    const keys = sessionIndex.get(sessionID)
    if (!keys) continue
    for (const key of [...keys]) {
      dropCacheKey(key)
    }
  }
}

export function getInlineImageCacheBytesForSession(sessionID: string) {
  return [...(sessionIndex.get(sessionID) ?? [])].reduce((sum, key) => sum + (cache.get(key)?.bytes ?? 0), 0)
}

export function estimateInlineImagePartBytes(part: { url: string }) {
  return entryBytes(part.url)
}

export function resetInlineImageCache() {
  cache.clear()
  sessionIndex.clear()
  cacheBytes = 0
  cacheLimits = {
    maxEntries: INLINE_IMAGE_CACHE_MAX_ENTRIES,
    maxBytes: INLINE_IMAGE_CACHE_MAX_BYTES,
  }
}

export function setInlineImageCacheLimits(input: Partial<typeof cacheLimits>) {
  cacheLimits = {
    maxEntries: input.maxEntries ?? cacheLimits.maxEntries,
    maxBytes: input.maxBytes ?? cacheLimits.maxBytes,
  }
  enforceCacheLimits()
}
