import { describe, expect, test } from "bun:test"
import type { Part } from "@lfcode-ai/sdk/v2/client"
import { isInlineImageCacheUrl, resolveInlineImageUrl } from "@lfcode-ai/ui/inline-image-cache"
import { sanitizeSessionPart } from "./session-part-sanitize"

const imagePart = (id: string, sessionID: string, messageID: string): Extract<Part, { type: "file" }> => ({
  id,
  sessionID,
  messageID,
  type: "file",
  mime: "image/png",
  filename: "image.png",
  url: "data:image/png;base64," + "A".repeat(400_000),
})

const toolPart = (output: string, attachments?: Extract<Part, { type: "file" }>[]): Extract<Part, { type: "tool" }> => ({
  id: "prt_tool",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "tool",
  callID: "call_1",
  tool: "read",
  state: {
    status: "completed",
    input: {},
    output,
    title: "Read image",
    metadata: {},
    time: {
      start: 1,
      end: 2,
    },
    attachments,
  },
})

describe("sanitizeSessionPart", () => {
  test("stashes oversized inline image attachments for tool parts", () => {
    const attachment = imagePart("prt_img", "ses_1", "msg_1")
    const part = sanitizeSessionPart(toolPart("Image read successfully", [attachment]))

    expect(part.type).toBe("tool")
    if (part.type !== "tool" || part.state.status !== "completed") return
    const stored = part.state.attachments?.[0]
    expect(stored).toBeDefined()
    expect(isInlineImageCacheUrl(stored!.url)).toBe(true)
    expect(resolveInlineImageUrl(stored!)).toContain("data:image/png;base64,")
  })

  test("compacts oversized completed tool outputs before storing", () => {
    const output = "A".repeat(30_000) + "TAIL"
    const part = sanitizeSessionPart(toolPart(output))

    expect(part.type).toBe("tool")
    if (part.type !== "tool" || part.state.status !== "completed") return
    expect(part.state.output.length).toBeLessThan(output.length)
    expect(part.state.output).toContain("[lfcode truncated large tool output in UI:")
    expect(part.state.output.startsWith("A".repeat(1_024))).toBe(true)
    expect(part.state.output.endsWith("TAIL")).toBe(true)
  })
})
