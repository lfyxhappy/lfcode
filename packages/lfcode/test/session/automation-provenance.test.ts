import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"

function user(input: Record<string, unknown>) {
  return MessageV2.User.parse({
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "user",
    time: { created: Date.UTC(2026, 7, 6, 9, 0) },
    agent: "main",
    model: { providerID: "provider", modelID: "model" },
    ...input,
  })
}

describe("automation prompt provenance", () => {
  test("persists the automation source with task and run identifiers", () => {
    const message = user({
      source: "automation",
      provenance: { taskID: "task_01", runID: "run_01" },
    })

    expect(message.source).toBe("automation")
    expect(message.provenance).toEqual({ taskID: "task_01", runID: "run_01" })
  })

  test("continues to parse hook provenance from existing message history", () => {
    const message = user({
      source: "hook",
      provenance: { hookPhase: "post", hookIteration: 2, pluginNames: ["example"], hookIDs: ["hook_01"] },
    })

    expect(message.provenance).toEqual({
      hookPhase: "post",
      hookIteration: 2,
      pluginNames: ["example"],
      hookIDs: ["hook_01"],
    })
  })
})
