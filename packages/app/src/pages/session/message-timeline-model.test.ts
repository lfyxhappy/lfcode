import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"
import { buildMessageTimelineModel, sameTimelinePartStructure } from "./message-timeline-model"

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

function part(messageID: string, value: Record<string, unknown>) {
  return {
    id: `${messageID}-${String(value.type)}`,
    sessionID: "session-1",
    messageID,
    ...value,
  } as Part
}

describe("buildMessageTimelineModel", () => {
  test("keeps the context snapshot stable for non-structural stream text deltas", () => {
    const previous = {
      "assistant-1": [part("assistant-1", { type: "text", text: "first streamed chunk" })],
      "user-1": [part("user-1", { type: "text", text: "original prompt" })],
    } satisfies Record<string, Part[]>
    const next = {
      "assistant-1": [part("assistant-1", { type: "text", text: "first streamed chunk with more text" })],
      "user-1": [part("user-1", { type: "text", text: "edited prompt text" })],
    } satisfies Record<string, Part[]>

    expect(sameTimelinePartStructure(previous, next)).toBe(true)
    expect(
      sameTimelinePartStructure(previous, {
        ...next,
        "assistant-1": [part("assistant-1", { type: "text", text: "" })],
      }),
    ).toBe(false)
    expect(
      sameTimelinePartStructure(previous, {
        ...next,
        "user-1": [part("user-1", { type: "compaction", auto: true })],
      }),
    ).toBe(false)
    expect(sameTimelinePartStructure({ "assistant-1": [] }, { "assistant-2": [] })).toBe(false)
  })

  test("keeps compaction summary assistants attached when only the boundary turn is rendered", () => {
    const messages = [
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("compaction-1"),
      assistant({ id: "assistant-summary", parentID: "compaction-1", completed: 20 }),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "assistant-summary": [part("assistant-summary", { type: "text", text: "summary text" })],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineModel({
      messages,
      renderedUsers: [messages[2] as UserMessage],
      partsByMessageID,
    })

    expect(result.context.activeContext.map((message) => message.id)).toEqual([
      "compaction-1",
      "assistant-summary",
      "user-2",
    ])
    expect([...result.turnLookup.turns.keys()]).toEqual(["compaction-1"])
    expect(result.turnLookup.turns.get("compaction-1")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-summary",
    ])
    expect(result.attributes).toEqual({
      compactionState: "compacted",
      activeContextBoundaryID: "compaction-1",
      activeContextBoundaryKind: "compaction",
    })
  })

  test("keeps checkpoint-only timelines idle without compaction markers", () => {
    const messages = [
      user("checkpoint-1"),
      assistant({ id: "assistant-1", parentID: "checkpoint-1", completed: 20 }),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "checkpoint-1": [
        part("checkpoint-1", {
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: "root",
        }),
        part("checkpoint-1", { type: "text", text: "## Checkpoint\nrebuild body" }),
      ],
      "assistant-1": [part("assistant-1", { type: "text", text: "checkpoint summary" })],
      "user-2": [part("user-2", { type: "text", text: "continue from checkpoint" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineModel({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[2] as UserMessage],
      partsByMessageID,
    })

    expect(result.attributes).toEqual({
      compactionState: "idle",
      activeContextBoundaryID: "checkpoint-1",
      activeContextBoundaryKind: "checkpoint",
    })
    expect(result.turnLookup.turns.get("checkpoint-1")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-1",
    ])
  })

  test("exposes failed compaction state while failing open to the full raw timeline", () => {
    const messages = [
      user("user-1"),
      assistant({ id: "assistant-1", parentID: "user-1", completed: 10 }),
      user("compaction-1"),
      assistant({ id: "assistant-summary", parentID: "compaction-1", completed: 20 }),
      user("user-2"),
    ] satisfies MessageType[]
    const partsByMessageID = {
      "user-1": [part("user-1", { type: "text", text: "older raw history" })],
      "assistant-1": [part("assistant-1", { type: "text", text: "older assistant" })],
      "compaction-1": [part("compaction-1", { type: "compaction", auto: true })],
      "assistant-summary": [],
      "user-2": [part("user-2", { type: "text", text: "continue from here" })],
    } satisfies Record<string, Part[]>

    const result = buildMessageTimelineModel({
      messages,
      renderedUsers: [messages[0] as UserMessage, messages[2] as UserMessage, messages[4] as UserMessage],
      partsByMessageID,
    })

    expect(result.context.activeContext.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "compaction-1",
      "assistant-summary",
      "user-2",
    ])
    expect(result.attributes).toEqual({
      compactionState: "failed",
      activeContextBoundaryID: undefined,
      activeContextBoundaryKind: undefined,
    })
    expect(result.turnLookup.turns.get("compaction-1")?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-summary",
    ])
  })
})
