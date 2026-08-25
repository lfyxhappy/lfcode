import { describe, expect, test } from "bun:test"
import { clipboardImagePayload } from "./clipboard-image"

describe("clipboardImagePayload", () => {
  test("copies only the PNG byte range instead of its backing buffer", () => {
    const png = new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)
    const payload = clipboardImagePayload({
      isEmpty: () => false,
      toPNG: () => png,
      getSize: () => ({ width: 20, height: 10 }),
    })

    expect(payload && [...new Uint8Array(payload.buffer)]).toEqual([2, 3, 4])
    expect(payload?.width).toBe(20)
    expect(payload?.height).toBe(10)
  })
})
