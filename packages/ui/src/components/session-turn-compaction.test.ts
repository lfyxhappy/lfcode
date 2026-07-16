import { describe, expect, test } from "bun:test"
import type { Message, Part, Session } from "@lfcode-ai/sdk/v2/client"
import { getSessionTurnCompactionState } from "./session-turn-compaction"

function userMessage(id: string, parts: Part[]): Message {
  return {
    id,
    role: "user",
    sessionID: "ses_1",
    time: { created: 1 },
    agent: "main",
    model: { providerID: "provider", modelID: "model" },
    parts,
  } as unknown as Message
}

function part(id: string, messageID: string, value: Record<string, unknown>) {
  return {
    ...value,
    id,
    sessionID: "ses_1",
    messageID,
  } as unknown as Part
}

function session(compacting?: number): Session {
  return {
    id: "ses_1",
    slug: "test",
    title: "test",
    directory: "C:/tmp",
    projectID: "proj_1",
    version: "1",
    time: {
      created: 0,
      updated: 0,
      compacting,
    },
  } as unknown as Session
}

describe("session turn compaction state", () => {
  test("treats checkpoint-only turns as idle", () => {
    const parts = [
      part("part_1", "msg_1", {
        type: "checkpoint",
        checkpointDir: "C:/tmp",
        checkpointNumber: 1,
        coveredUpTo: "msg_0",
      }),
    ]
    const message = userMessage("msg_1", parts)

    expect(
      getSessionTurnCompactionState({
        session: session(),
        message,
        latestBoundaryMessageID: message.id,
        parts,
        assistantMessageCount: 0,
        assistantParts: [],
      }),
    ).toBe("idle")
  })

  test("shows compacting only for the latest compaction boundary", () => {
    const parts = [
      part("part_2", "msg_2", {
        type: "compaction",
        auto: true,
      }),
    ]
    const message = userMessage("msg_2", parts)

    expect(
      getSessionTurnCompactionState({
        session: session(123),
        message,
        latestBoundaryMessageID: message.id,
        parts,
        assistantMessageCount: 0,
        assistantParts: [],
      }),
    ).toBe("compacting")
  })

  test("shows compacted when the boundary has a visible assistant summary", () => {
    const parts = [
      part("part_2", "msg_2", {
        type: "compaction",
        auto: true,
      }),
    ]
    const message = userMessage("msg_2", parts)

    expect(
      getSessionTurnCompactionState({
        session: session(),
        message,
        latestBoundaryMessageID: message.id,
        parts,
        assistantMessageCount: 1,
        assistantParts: [
          part("part_3", "asst_1", {
            type: "text",
            text: "summary text",
          }),
        ],
      }),
    ).toBe("compacted")
  })

  test("shows failed when compaction assistant exists but produced no visible summary", () => {
    const parts = [
      part("part_2", "msg_2", {
        type: "compaction",
        auto: true,
      }),
    ]
    const message = userMessage("msg_2", parts)

    expect(
      getSessionTurnCompactionState({
        session: session(),
        message,
        latestBoundaryMessageID: message.id,
        parts,
        assistantMessageCount: 1,
        assistantParts: [],
      }),
    ).toBe("failed")
  })
})
