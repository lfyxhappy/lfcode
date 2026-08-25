import { describe, expect, test } from "bun:test"
import { tavernCanSend, tavernImageAttachment } from "./tavern-media"

describe("tavern media", () => {
  test("accepts a supported image as a message attachment", async () => {
    const attachment = await tavernImageAttachment(new File(["image"], "scene.png", { type: "image/png" }))

    expect(attachment).toMatchObject({
      type: "image",
      filename: "scene.png",
      mime: "image/png",
    })
    expect(attachment?.dataUrl).toStartWith("data:image/png;base64,")
  })

  test("rejects non-image files", async () => {
    const attachment = await tavernImageAttachment(new File(["text"], "notes.txt", { type: "text/plain" }))

    expect(attachment).toBeUndefined()
  })

  test("allows a message that only contains images", () => {
    expect(tavernCanSend("", [{ type: "image", id: "image_1", filename: "scene.png", mime: "image/png", dataUrl: "data:image/png;base64,AA" }])).toBe(true)
    expect(tavernCanSend("   ", [])).toBe(false)
  })
})
