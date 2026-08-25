import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildTimelineTurnLookup, isRealUserMessage, isShellProcessNotice } from "./message-timeline-turns"

function user(id: string): UserMessage {
  return {
    id,
    sessionID: "session-1",
    role: "user",
    time: { created: 1 },
  } as UserMessage
}

function assistant(input: { id: string; parentID: string; completed?: number }): AssistantMessage {
  return {
    id: input.id,
    sessionID: "session-1",
    role: "assistant",
    parentID: input.parentID,
    time: input.completed ? { created: 2, completed: input.completed } : { created: 2 },
    modelID: "model-1",
    providerID: "provider-1",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as AssistantMessage
}

describe("buildTimelineTurnLookup", () => {
  test("groups assistant replies under their parent user message", () => {
    const result = buildTimelineTurnLookup([
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      assistant({ id: "assistant-2", parentID: "user-1", completed: 20 }),
      user("user-2"),
    ] satisfies MessageType[])

    expect(result.turns.get("user-1")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2",
    ])
    expect(result.turns.get("user-2")?.assistantMessages).toEqual([])
  })

  test("groups assistant replies even when the message list is not parent-first", () => {
    const result = buildTimelineTurnLookup([
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("user-1"),
      user("user-2"),
    ] satisfies MessageType[])

    expect(result.turns.get("user-1")?.assistantMessages.map((message) => message.id)).toEqual(["assistant-1"])
  })

  test("keeps the latest pending turn active", () => {
    const result = buildTimelineTurnLookup([
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("user-2"),
      assistant({ id: "assistant-2", parentID: "user-2" }),
    ] satisfies MessageType[])

    expect(result.activeMessageID).toBe("user-2")
  })

  test("can build only the rendered user window while still attaching matching assistants", () => {
    const messages = [
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("user-2"),
      assistant({ id: "assistant-2", parentID: "user-2", completed: 20 }),
    ] satisfies MessageType[]

    const result = buildTimelineTurnLookup(messages, [messages[2] as UserMessage])

    expect([...result.turns.keys()]).toEqual(["user-2"])
    expect(result.turns.get("user-2")?.assistantMessages.map((message) => message.id)).toEqual(["assistant-2"])
  })

  test("keeps compaction-summary assistants attached when only the boundary turn is rendered", () => {
    const messages = [
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("compaction-boundary"),
      assistant({ id: "assistant-summary", parentID: "compaction-boundary", completed: 20 }),
      user("user-3"),
    ] satisfies MessageType[]

    const result = buildTimelineTurnLookup(messages, [messages[2] as UserMessage])

    expect([...result.turns.keys()]).toEqual(["compaction-boundary"])
    expect(result.turns.get("compaction-boundary")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-summary",
    ])
  })

  test("keeps the compaction boundary turn active while its summary assistant is still pending", () => {
    const messages = [
      user("compaction-boundary"),
      assistant({ id: "assistant-summary", parentID: "compaction-boundary" }),
      user("user-2"),
    ] satisfies MessageType[]

    const result = buildTimelineTurnLookup(messages, [messages[0] as UserMessage, messages[2] as UserMessage])

    expect(result.activeMessageID).toBe("compaction-boundary")
  })

  test("keeps shell completion notifications in the preceding user turn", () => {
    const messages = [
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("shell-notice"),
      assistant({ id: "assistant-2", parentID: "shell-notice", completed: 20 }),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "shell-notice": [
        {
          id: "notice-part",
          sessionID: "session-1",
          messageID: "shell-notice",
          type: "text",
          synthetic: true,
          text: "Shell process updates:\n- completed: job_id job-1",
        },
      ],
    } satisfies Record<string, Part[]>

    expect(isShellProcessNotice(messages[2]!, partsByMessageID)).toBe(true)
    const result = buildTimelineTurnLookup(messages, undefined, partsByMessageID)

    expect([...result.turns.keys()]).toEqual(["user-1"])
    expect(result.turns.get("user-1")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2",
    ])
  })

  test("does not create turns for generic synthetic user messages", () => {
    const messages = [user("user-1"), user("system-note")] satisfies MessageType[]
    const parts = {
      "system-note": [
        {
          id: "system-part",
          sessionID: "session-1",
          messageID: "system-note",
          type: "text",
          synthetic: true,
          text: "<system-reminder>continue</system-reminder>",
        },
      ],
    } satisfies Record<string, Part[]>

    expect(isRealUserMessage(messages[0]!, parts)).toBe(true)
    expect(isRealUserMessage(messages[1]!, parts)).toBe(false)
    expect([...buildTimelineTurnLookup(messages, undefined, parts).turns.keys()]).toEqual(["user-1"])
  })
})
