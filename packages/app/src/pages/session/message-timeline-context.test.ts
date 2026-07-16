import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildMessageTimelineContext } from "./message-timeline-context"

function user(id: string): UserMessage {
  return {
    id,
    sessionID: "session-1",
    role: "user",
    time: { created: 1 },
  } as UserMessage
}

function assistant(id: string, parentID: string): AssistantMessage {
  return {
    id,
    sessionID: "session-1",
    role: "assistant",
    parentID,
    time: { created: 2, completed: 3 },
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

function part(messageID: string, value: Record<string, unknown>) {
  return {
    id: `${messageID}-${String(value.type)}`,
    sessionID: "session-1",
    messageID,
    ...value,
  } as Part
}

describe("buildMessageTimelineContext", () => {
  test("keeps full history while trimming active context to a valid checkpoint boundary", () => {
    const messages = [
      user("user-1"),
      assistant("assistant-1", "user-1"),
      user("checkpoint-1"),
      assistant("assistant-2", "checkpoint-1"),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "checkpoint-1": [
        part("checkpoint-1", {
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: "user-1",
        }),
        part("checkpoint-1", { type: "text", text: "## Checkpoint\nrebuild body" }),
      ],
      "assistant-2": [part("assistant-2", { type: "text", text: "summary assistant" })],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineContext({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[2] as UserMessage, messages[4] as UserMessage],
      partsByMessageID,
    })

    expect(result.fullHistory.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "checkpoint-1",
      "assistant-2",
      "user-2",
    ])
    expect(result.activeContext.map((message) => message.id)).toEqual(["checkpoint-1", "assistant-2", "user-2"])
    expect(result.renderedActiveContext.map((message) => message.id)).toEqual(["checkpoint-1", "user-2"])
    expect(result.activeContextBoundary).toEqual({
      messageID: "checkpoint-1",
      kind: "checkpoint",
    })
    expect(result.compactionState).toBe("idle")
  })

  test("reports compacting when the latest compaction boundary has no summary yet but the session is compacting", () => {
    const messages = [user("compaction-1"), user("user-2")] satisfies MessageType[]
    const partsByMessageID = {
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "user-2": [part("user-2", { type: "text", text: "latest user" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineContext({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[1] as UserMessage],
      partsByMessageID,
      sessionCompacting: Date.now(),
    })

    expect(result.compactionState).toBe("compacting")
    expect(result.activeContext.map((message) => message.id)).toEqual(["compaction-1", "user-2"])
    expect(result.activeContextBoundary).toBeUndefined()
  })

  test("reports compacted and uses the compaction boundary once a visible summary exists", () => {
    const messages = [
      user("user-1"),
      assistant("assistant-1", "user-1"),
      user("compaction-1"),
      assistant("assistant-summary", "compaction-1"),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "assistant-summary": [part("assistant-summary", { type: "text", text: "summary text" })],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineContext({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[2] as UserMessage, messages[4] as UserMessage],
      partsByMessageID,
    })

    expect(result.compactionState).toBe("compacted")
    expect(result.activeContext.map((message) => message.id)).toEqual([
      "compaction-1",
      "assistant-summary",
      "user-2",
    ])
    expect(result.activeContextBoundary).toEqual({
      messageID: "compaction-1",
      kind: "compaction",
    })
  })

  test("skips the latest invalid boundary and falls back to an earlier valid checkpoint", () => {
    const messages = [
      user("user-1"),
      assistant("assistant-1", "user-1"),
      user("checkpoint-1"),
      assistant("assistant-2", "checkpoint-1"),
      user("compaction-1"),
      assistant("assistant-summary", "compaction-1"),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "checkpoint-1": [
        part("checkpoint-1", {
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: "user-1",
        }),
        part("checkpoint-1", { type: "text", text: "## Checkpoint\nrebuild body" }),
      ],
      "assistant-2": [part("assistant-2", { type: "text", text: "checkpoint summary" })],
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "assistant-summary": [],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineContext({
      messages,
      renderedUsers: [
        messages[0] as UserMessage,
        messages[2] as UserMessage,
        messages[4] as UserMessage,
        messages[6] as UserMessage,
      ],
      partsByMessageID,
    })

    expect(result.activeContext.map((message) => message.id)).toEqual([
      "checkpoint-1",
      "assistant-2",
      "compaction-1",
      "assistant-summary",
      "user-2",
    ])
    expect(result.renderedActiveContext.map((message) => message.id)).toEqual([
      "checkpoint-1",
      "compaction-1",
      "user-2",
    ])
    expect(result.activeContextBoundary).toEqual({
      messageID: "checkpoint-1",
      kind: "checkpoint",
    })
    expect(result.compactionState).toBe("failed")
  })

  test("fails open to raw history when the latest compaction boundary has an assistant but no visible summary", () => {
    const messages = [
      user("user-1"),
      assistant("assistant-1", "user-1"),
      user("compaction-1"),
      assistant("assistant-summary", "compaction-1"),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "assistant-summary": [],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineContext({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[2] as UserMessage, messages[4] as UserMessage],
      partsByMessageID,
    })

    expect(result.compactionState).toBe("failed")
    expect(result.activeContext.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "compaction-1",
      "assistant-summary",
      "user-2",
    ])
    expect(result.activeContextBoundary).toBeUndefined()
  })
})
