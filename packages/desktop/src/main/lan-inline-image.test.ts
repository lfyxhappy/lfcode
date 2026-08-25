import { expect, test } from "bun:test"
import { LAN_INLINE_IMAGE_MAX_BYTES, readLanInlineImage } from "./lan-inline-image"

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString("base64")}`

test("reads only bounded image data URLs with matching signatures", () => {
  expect(readLanInlineImage(png)).toMatchObject({ mime: "image/png" })
  expect(readLanInlineImage("data:image/png;base64,AAAA")).toBeUndefined()
  expect(readLanInlineImage("data:text/plain;base64,aGVsbG8=")).toBeUndefined()
  expect(readLanInlineImage("https://example.com/image.png")).toBeUndefined()
  expect(readLanInlineImage(`data:image/png;base64,${Buffer.alloc(LAN_INLINE_IMAGE_MAX_BYTES + 1, 0).toString("base64")}`)).toBeUndefined()
})
