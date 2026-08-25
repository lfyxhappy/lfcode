import { describe, expect, test } from "bun:test"
import {
  dropInlineImageCacheForParts,
  dropInlineImageCacheForSessions,
  getInlineImageCacheBytesForSession,
  isInlineImageCacheUrl,
  resetInlineImageCache,
  resolveInlineImageUrl,
  setInlineImageCacheLimits,
  stashInlineImagePart,
} from "./inline-image-cache"

const filePart = (overrides: Partial<{
  id: string
  sessionID: string
  messageID: string
  mime: string
  url: string
}> = {}) => ({
  id: "part_1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "file" as const,
  mime: "image/png",
  url: "data:image/png;base64," + "A".repeat(400_000),
  ...overrides,
})

describe("inline image cache", () => {
  test("evicts least-recently-used entries by count and bytes", () => {
    resetInlineImageCache()
    setInlineImageCacheLimits({ maxEntries: 2, maxBytes: 2_000_000 })

    const first = stashInlineImagePart(filePart({ id: "part_1", messageID: "msg_1", sessionID: "ses_1" }))
    const second = stashInlineImagePart(filePart({ id: "part_2", messageID: "msg_2", sessionID: "ses_2" }))
    const third = stashInlineImagePart(filePart({ id: "part_3", messageID: "msg_3", sessionID: "ses_3" }))

    expect(resolveInlineImageUrl(first)).toBeUndefined()
    expect(resolveInlineImageUrl(second)).toContain("data:image/png;base64,")
    expect(resolveInlineImageUrl(third)).toContain("data:image/png;base64,")
    expect(getInlineImageCacheBytesForSession("ses_1")).toBe(0)
  })

  test("stashes oversized inline images outside the reactive store payload", () => {
    resetInlineImageCache()
    const part = stashInlineImagePart(filePart())

    expect(isInlineImageCacheUrl(part.url)).toBe(true)
    expect(resolveInlineImageUrl(part)).toContain("data:image/png;base64,")
  })

  test("ignores small or non-image attachments", () => {
    resetInlineImageCache()
    const small = stashInlineImagePart(filePart({ url: "data:image/png;base64,QUJD" }))
    const text = stashInlineImagePart(filePart({ mime: "text/plain", url: "data:text/plain;base64,QUJD" }))

    expect(isInlineImageCacheUrl(small.url)).toBe(false)
    expect(isInlineImageCacheUrl(text.url)).toBe(false)
    expect(resolveInlineImageUrl(small)).toBe("data:image/png;base64,QUJD")
  })

  test("drops cached originals by part or session", () => {
    resetInlineImageCache()
    const first = stashInlineImagePart(filePart())
    const second = stashInlineImagePart(filePart({ id: "part_2", sessionID: "ses_2", messageID: "msg_2" }))

    dropInlineImageCacheForParts([first])
    expect(resolveInlineImageUrl(first)).toBeUndefined()
    expect(resolveInlineImageUrl(second)).toContain("data:image/png;base64,")

    dropInlineImageCacheForSessions(["ses_2"])
    expect(resolveInlineImageUrl(second)).toBeUndefined()
  })
})
