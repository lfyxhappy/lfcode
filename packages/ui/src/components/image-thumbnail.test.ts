import { describe, expect, test } from "bun:test"
import {
  estimateDataUrlBytes,
  IMAGE_THUMBNAIL_MAX_BYTES,
  getThumbnailCacheBytes,
  getThumbnailCacheEntryCount,
  resetThumbnailCache,
  setThumbnailCacheEntryForTest,
  setThumbnailCacheLimits,
  shouldGenerateImageThumbnail,
} from "./image-thumbnail"

describe("image thumbnail helpers", () => {
  test("evicts least-recently-used thumbnails by count and bytes", async () => {
    resetThumbnailCache()
    setThumbnailCacheLimits({ maxEntries: 2, maxBytes: 40_000 })

    setThumbnailCacheEntryForTest("one", 16_000)
    setThumbnailCacheEntryForTest("two", 16_000)
    setThumbnailCacheEntryForTest("three", 16_000)

    expect(getThumbnailCacheEntryCount()).toBeLessThanOrEqual(2)
    expect(getThumbnailCacheBytes()).toBeLessThanOrEqual(40_000)
  })

  test("estimates base64 data url size", () => {
    expect(estimateDataUrlBytes("data:image/png;base64,QUJD")).toBe(3)
    expect(estimateDataUrlBytes("data:image/png;base64,QUJDRA==")).toBe(4)
  })

  test("only marks oversized image data urls for thumbnail generation", () => {
    const large = "data:image/png;base64," + "A".repeat(Math.ceil((IMAGE_THUMBNAIL_MAX_BYTES + 1024) * 4 / 3))

    expect(shouldGenerateImageThumbnail({ src: "https://example.com/a.png" })).toBe(false)
    expect(shouldGenerateImageThumbnail({ src: "data:text/plain;base64,QUJD" })).toBe(false)
    expect(shouldGenerateImageThumbnail({ src: large })).toBe(true)
  })

  test("small previews keep the original data url out of derived preview state", async () => {
    resetThumbnailCache()
    const src = "data:image/png;base64,QUJD"

    expect(shouldGenerateImageThumbnail({ src })).toBe(false)
    expect(getThumbnailCacheEntryCount()).toBe(0)
    expect(getThumbnailCacheBytes()).toBe(0)
  })
})
