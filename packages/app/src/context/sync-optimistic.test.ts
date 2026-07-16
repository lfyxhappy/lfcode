import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@lfcode-ai/sdk/v2/client"
import { isInlineImageCacheUrl, resolveInlineImageUrl } from "@lfcode-ai/ui/inline-image-cache"
import { applyOptimisticAdd, applyOptimisticRemove, mergeOptimisticPage } from "./sync"

type Text = Extract<Part, { type: "text" }>

const userMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const textPart = (id: string, sessionID: string, messageID: string): Text => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text: id,
})

const imagePart = (id: string, sessionID: string, messageID: string): Extract<Part, { type: "file" }> => ({
  id,
  sessionID,
  messageID,
  type: "file",
  mime: "image/png",
  filename: "image.png",
  url: "data:image/png;base64," + "A".repeat(400_000),
})

const toolPart = (id: string, sessionID: string, messageID: string): Extract<Part, { type: "tool" }> => ({
  id,
  sessionID,
  messageID,
  type: "tool",
  callID: "call_1",
  tool: "read",
  state: {
    status: "completed",
    input: {},
    output: "Image read successfully",
    title: "Read image",
    metadata: {},
    time: {
      start: 1,
      end: 2,
    },
    attachments: [imagePart("prt_tool_img", sessionID, messageID)],
  },
})

describe("sync optimistic reducers", () => {
  test("applyOptimisticAdd inserts message in sorted order and stores parts", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_2", sessionID)] },
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [textPart("prt_2", sessionID, "msg_1"), textPart("prt_1", sessionID, "msg_1")],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
  })

  test("applyOptimisticRemove removes message and part entries", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)] },
      part: {
        msg_1: [textPart("prt_1", sessionID, "msg_1")],
        msg_2: [textPart("prt_2", sessionID, "msg_2")],
      } as Record<string, Part[] | undefined>,
    }

    applyOptimisticRemove(draft, { sessionID, messageID: "msg_1" })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_2"])
    expect(draft.part.msg_1).toBeUndefined()
    expect(draft.part.msg_2).toHaveLength(1)
  })

  test("applyOptimisticAdd stashes oversized inline image payloads outside the store", () => {
    const sessionID = "ses_1"
    const draft = {
      message: {} as Record<string, Message[] | undefined>,
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [imagePart("prt_img", sessionID, "msg_1")],
    })

    const stored = draft.part.msg_1?.[0]
    expect(stored?.type).toBe("file")
    if (stored?.type === "file") {
      expect(isInlineImageCacheUrl(stored.url)).toBe(true)
      expect(resolveInlineImageUrl(stored)).toContain("data:image/png;base64,")
    }
  })

  test("applyOptimisticAdd stashes oversized tool attachments outside the store", () => {
    const sessionID = "ses_1"
    const draft = {
      message: {} as Record<string, Message[] | undefined>,
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [toolPart("prt_tool", sessionID, "msg_1")],
    })

    const stored = draft.part.msg_1?.[0]
    expect(stored?.type).toBe("tool")
    if (stored?.type === "tool" && stored.state.status === "completed") {
      const attachment = stored.state.attachments?.[0]
      expect(attachment).toBeDefined()
      expect(isInlineImageCacheUrl(attachment!.url)).toBe(true)
      expect(resolveInlineImageUrl(attachment!)).toContain("data:image/png;base64,")
    }
  })

  test("mergeOptimisticPage keeps pending messages in fetched timelines", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_1", sessionID)],
        part: [{ id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] }],
        complete: true,
      },
      [{ message: userMessage("msg_2", sessionID), parts: [textPart("prt_2", sessionID, "msg_2")] }],
    )

    expect(page.session.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(page.part.find((x) => x.id === "msg_2")?.part.map((x) => x.id)).toEqual(["prt_2"])
    expect(page.confirmed).toEqual([])
    expect(page.complete).toBe(true)
  })

  test("mergeOptimisticPage keeps missing optimistic parts until the server has them", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_2", sessionID)],
        part: [{ id: "msg_2", part: [textPart("prt_2", sessionID, "msg_2")] }],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_1", sessionID, "msg_2"), textPart("prt_2", sessionID, "msg_2")],
        },
      ],
    )

    expect(page.part.find((x) => x.id === "msg_2")?.part.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
    expect(page.confirmed).toEqual([])
  })

  test("mergeOptimisticPage confirms echoed messages once all parts arrive", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_2", sessionID)],
        part: [
          {
            id: "msg_2",
            part: [{ ...textPart("prt_1", sessionID, "msg_2"), text: "server" }, textPart("prt_2", sessionID, "msg_2")],
          },
        ],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_1", sessionID, "msg_2"), textPart("prt_2", sessionID, "msg_2")],
        },
      ],
    )

    expect(page.confirmed).toEqual(["msg_2"])
    expect(page.part.find((x) => x.id === "msg_2")?.part).toMatchObject([
      { id: "prt_1", type: "text", text: "server" },
      { id: "prt_2", type: "text", text: "prt_2" },
    ])
  })
})
