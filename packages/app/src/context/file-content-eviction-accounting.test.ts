import { afterEach, describe, expect, test } from "bun:test"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"

describe("file content eviction accounting", () => {
  afterEach(() => {
    resetFileContentLru()
  })

  test("updates byte totals incrementally for set, overwrite, remove, and reset", () => {
    setFileContentBytes("a", 10)
    setFileContentBytes("b", 15)
    expect(getFileContentBytesTotal()).toBe(25)
    expect(getFileContentEntryCount()).toBe(2)

    setFileContentBytes("a", 5)
    expect(getFileContentBytesTotal()).toBe(20)
    expect(getFileContentEntryCount()).toBe(2)

    touchFileContent("a")
    expect(getFileContentBytesTotal()).toBe(20)

    removeFileContentBytes("b")
    expect(getFileContentBytesTotal()).toBe(5)
    expect(getFileContentEntryCount()).toBe(1)

    resetFileContentLru()
    expect(getFileContentBytesTotal()).toBe(0)
    expect(getFileContentEntryCount()).toBe(0)
  })

  test("evicts by entry cap using LRU order", () => {
    for (const i of Array.from({ length: 41 }, (_, n) => n)) {
      setFileContentBytes(`f-${i}`, 1)
    }

    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))

    expect(evicted).toEqual(["f-0"])
    expect(getFileContentEntryCount()).toBe(40)
    expect(getFileContentBytesTotal()).toBe(40)
  })

  test("evicts by byte cap while preserving protected entries", () => {
    const chunk = 8 * 1024 * 1024
    setFileContentBytes("a", chunk)
    setFileContentBytes("b", chunk)
    setFileContentBytes("c", chunk)

    const evicted: string[] = []
    evictContentLru(new Set(["a"]), (path) => evicted.push(path))

    expect(evicted).toEqual(["b"])
    expect(getFileContentEntryCount()).toBe(2)
    expect(getFileContentBytesTotal()).toBe(chunk * 2)
  })

  test("counts only cached file body bytes", () => {
    expect(
      approxBytes({
        type: "text",
        exists: true,
        content: "hello",
        checksum: "checksum-hello",
        diff: "@@ -1 +1 @@\n-old\n+new\n",
        patch: {
          oldFileName: "a.txt",
          newFileName: "a.txt",
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
        },
      }),
    ).toBe("hello".length * 2)
  })
})
