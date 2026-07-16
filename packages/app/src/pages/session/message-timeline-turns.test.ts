import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message as MessageType, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildTimelineTurnLookup } from "./message-timeline-turns"

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
})
