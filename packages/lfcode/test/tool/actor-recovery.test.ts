import { describe, expect, test } from "bun:test"
import { recoverActorArgs } from "../../src/tool/actor"

describe("recoverActorArgs", () => {
  test("normalizes flattened wait and keeps only valid fields", () => {
    expect(recoverActorArgs({ operation: "wait", actor_id: "general-1", timeout_ms: 300000, prompt: "drop" })).toEqual({
      operation: { action: "wait", actor_id: "general-1", timeout_ms: 300000 },
    })
  })

  test("normalizes flattened status and send envelopes", () => {
    expect(recoverActorArgs({ operation: "status", actor_id: "general-1" })).toEqual({
      operation: { action: "status", actor_id: "general-1" },
    })
    expect(recoverActorArgs({ operation: "send", to_actor_id: "general-1", content: "continue", timeout_ms: 1 })).toEqual({
      operation: { action: "send", to_actor_id: "general-1", content: "continue" },
    })
  })
})

