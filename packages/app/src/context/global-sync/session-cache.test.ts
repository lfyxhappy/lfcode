import { describe, expect, test } from "bun:test"
import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@lfcode-ai/sdk/v2/client"
import {
  isInlineImageCacheUrl,
  resetInlineImageCache,
  resolveInlineImageUrl,
  stashInlineImagePart,
} from "@lfcode-ai/ui/inline-image-cache"
import {
  dropSessionCaches,
  estimateSessionCacheBytes,
  pickOversizedSessionCaches,
  pickSessionCacheEvictions,
  SESSION_MESSAGE_CACHE_LIMIT,
  SESSION_PART_CACHE_LIMIT,
  SESSION_CACHE_BYTES_LIMIT,
} from "./session-cache"

const msg = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const part = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }) as Part

describe("app session cache", () => {
  test("estimates session cache bytes from messages and parts", () => {
    const messages = [msg("msg_1", "ses_1")]
    const parts = [part("prt_1", "ses_1", "msg_1")]

    expect(estimateSessionCacheBytes(messages, parts)).toBeGreaterThan(0)
  })

  test("dropSessionCaches clears orphaned parts without message rows", () => {
    resetInlineImageCache()
    const store: {
      session_status: Record<string, SessionStatus | undefined>
      session_diff: Record<string, SnapshotFileDiff[] | undefined>
      todo: Record<string, Todo[] | undefined>
      message: Record<string, Message[] | undefined>
      messageByAgent: Record<string, Record<string, Message[] | undefined> | undefined>
      actor: Record<
        string,
        {
          actorID: string
          sessionID: string
          mode: string
          status: string
          description: string
          time: { created: number }
          agent?: string
          parentActorID?: string
        }[]
        | undefined
      >
      part: Record<string, Part[] | undefined>
      permission: Record<string, PermissionRequest[] | undefined>
      question: Record<string, QuestionRequest[] | undefined>
    } = {
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      session_diff: { ses_1: [] },
      todo: { ses_1: [] as Todo[] },
      message: {},
      messageByAgent: {},
      actor: {},
      part: { msg_1: [part("prt_1", "ses_1", "msg_1")] },
      permission: { ses_1: [] as PermissionRequest[] },
      question: { ses_1: [] as QuestionRequest[] },
    }

    dropSessionCaches(store, ["ses_1"])

    expect(store.message.ses_1).toBeUndefined()
    expect(store.part.msg_1).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.session_status.ses_1).toBeUndefined()
    expect(store.permission.ses_1).toBeUndefined()
    expect(store.question.ses_1).toBeUndefined()
  })

  test("dropSessionCaches clears message-backed parts", () => {
    resetInlineImageCache()
    const m = msg("msg_1", "ses_1")
    const image = stashInlineImagePart({
      id: "prt_img",
      sessionID: "ses_1",
      messageID: m.id,
      type: "file" as const,
      mime: "image/png",
      url: "data:image/png;base64," + "A".repeat(400_000),
    })
    const store: {
      session_status: Record<string, SessionStatus | undefined>
      session_diff: Record<string, SnapshotFileDiff[] | undefined>
      todo: Record<string, Todo[] | undefined>
      message: Record<string, Message[] | undefined>
      messageByAgent: Record<string, Record<string, Message[] | undefined> | undefined>
      actor: Record<
        string,
        {
          actorID: string
          sessionID: string
          mode: string
          status: string
          description: string
          time: { created: number }
          agent?: string
          parentActorID?: string
        }[]
        | undefined
      >
      part: Record<string, Part[] | undefined>
      permission: Record<string, PermissionRequest[] | undefined>
      question: Record<string, QuestionRequest[] | undefined>
    } = {
      session_status: {},
      session_diff: {},
      todo: {},
      message: { ses_1: [m] },
      messageByAgent: {},
      actor: {},
      part: { [m.id]: [part("prt_1", "ses_1", m.id), image] },
      permission: {},
      question: {},
    }

    expect(isInlineImageCacheUrl(image.url)).toBe(true)
    expect(resolveInlineImageUrl(image)).toContain("data:image/png;base64,")

    dropSessionCaches(store, ["ses_1"])

    expect(store.message.ses_1).toBeUndefined()
    expect(store.part[m.id]).toBeUndefined()
    expect(resolveInlineImageUrl(image)).toBeUndefined()
  })

  test("pickSessionCacheEvictions preserves requested sessions", () => {
    const seen = new Set(["ses_1", "ses_2", "ses_3"])

    const stale = pickSessionCacheEvictions({
      seen,
      keep: "ses_4",
      limit: 2,
      preserve: ["ses_1"],
    })

    expect(stale).toEqual(["ses_2", "ses_3"])
    expect([...seen]).toEqual(["ses_1", "ses_4"])
  })

  test("pickOversizedSessionCaches skips current session and keeps over-limit sessions by messages, parts, or bytes", () => {
    const stale = pickOversizedSessionCaches({
      keep: "ses_keep",
      limit: SESSION_MESSAGE_CACHE_LIMIT,
      partLimit: SESSION_PART_CACHE_LIMIT,
      byteLimit: SESSION_CACHE_BYTES_LIMIT,
      message: {
        ses_keep: new Array(SESSION_MESSAGE_CACHE_LIMIT + 100).fill(msg("msg_keep", "ses_keep")),
        ses_small: new Array(12).fill(msg("msg_small", "ses_small")),
        ses_big: new Array(SESSION_MESSAGE_CACHE_LIMIT + 1).fill(msg("msg_big", "ses_big")),
        ses_bytes: [
          ({
            ...msg("msg_bytes", "ses_bytes"),
            text: "x".repeat(SESSION_CACHE_BYTES_LIMIT),
          } as unknown) as Message,
        ],
      },
      part: {
        msg_keep: new Array(SESSION_PART_CACHE_LIMIT + 1).fill(part("prt_keep", "ses_keep", "msg_keep")),
        msg_big: [
          part("prt_big", "ses_big", "msg_big"),
          stashInlineImagePart({
            id: "prt_big_img",
            sessionID: "ses_big",
            messageID: "msg_big",
            type: "file" as const,
            mime: "image/png",
            url: "data:image/png;base64," + "A".repeat(400_000),
          }),
        ],
      },
    })

    expect(stale).toEqual(["ses_big", "ses_bytes"])
  })
})
