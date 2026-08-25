import { describe, expect, test } from "bun:test"
import { LanPromptPayloadError, parseLanPromptPayload } from "./lan-prompt-attachments"

describe("LAN prompt attachments", () => {
  test("accepts a real image in multipart form data", async () => {
    const form = new FormData()
    form.set("text", "请看这张图")
    form.append("files", new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "image.png", { type: "image/png" }))
    const payload = await parseLanPromptPayload(new Request("https://lan.test", { method: "POST", body: form }))
    expect(payload.parts).toHaveLength(2)
    expect(payload.parts[1]).toMatchObject({ type: "file", mime: "image/png", filename: "image.png" })
  })

  test("rejects unsupported types and oversized files", async () => {
    const unsupported = new FormData()
    unsupported.append("files", new File(["MZ"], "program.exe", { type: "application/octet-stream" }))
    await expect(parseLanPromptPayload(new Request("https://lan.test", { method: "POST", body: unsupported }))).rejects.toBeInstanceOf(LanPromptPayloadError)

    const oversized = new FormData()
    oversized.append("files", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" }))
    await expect(parseLanPromptPayload(new Request("https://lan.test", { method: "POST", body: oversized }))).rejects.toMatchObject({ code: "attachment_too_large" })
  })
})
