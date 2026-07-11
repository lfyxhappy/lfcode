import { describe, expect, test } from "bun:test"
import {
  createSessionContentSignature,
  createSessionViewStateV4,
  migrateViewportStateV3,
  normalizeSessionViewStateV4,
  shouldRestoreSessionViewState,
} from "./session-view-state"

describe("session view state v4", () => {
  test("migrates a V3 semantic anchor without retaining pixel scroll state", () => {
    expect(
      migrateViewportStateV3({
        version: 3,
        mode: "anchor",
        assistantRevision: "assistant-1\\nidle",
        historyTurnStart: 4,
        anchorBlockId: "assistant-1:part-2",
        anchorTurnId: "user-1",
        anchorOffsetPx: 86,
        updatedAt: 7,
      }),
    ).toMatchObject({
      version: 4,
      history: { turnStart: 4 },
      viewport: {
        mode: "anchor",
        anchorRenderBlockID: "assistant-1:part-2",
        anchorTurnID: "user-1",
        offsetPx: 86,
      },
    })
  })

  test("rejects a stale anchor when assistant output changed or is streaming", () => {
    const state = createSessionViewStateV4({
      turnStart: 2,
      viewport: {
        version: 4,
        mode: "bottom",
        assistantRevision: "assistant-1\\nidle",
        historyTurnStart: 2,
        updatedAt: 1,
      },
    })
    expect(shouldRestoreSessionViewState({ state, assistantRevision: "assistant-1\\nidle", streaming: false })).toBe(true)
    expect(shouldRestoreSessionViewState({ state, assistantRevision: "assistant-2\\nidle", streaming: false })).toBe(false)
    expect(shouldRestoreSessionViewState({ state, assistantRevision: "assistant-1\\nidle", streaming: true })).toBe(false)
  })

  test("normalizes a serializable V4 anchor and rejects invalid offsets", () => {
    const valid = normalizeSessionViewStateV4({
      version: 4,
      viewport: {
        version: 4,
        mode: "anchor",
        assistantRevision: "stable",
        historyTurnStart: 3,
        anchorRenderBlockID: "block",
        anchorTurnID: "turn",
        offsetPx: 44,
        updatedAt: 1,
      },
      history: { turnStart: 3 },
      updatedAt: 1,
    })
    expect(valid?.viewport.mode).toBe("anchor")
    expect(
      normalizeSessionViewStateV4({
        version: 4,
        viewport: { version: 4, mode: "anchor", assistantRevision: "stable", historyTurnStart: 0, offsetPx: "no" },
        history: { turnStart: 0 },
        updatedAt: 1,
      }),
    ).toBeUndefined()
  })

  test("invalidates a cached view when the active assistant tail changes", () => {
    const base = createSessionContentSignature({
      status: "idle",
      updatedAt: 10,
      messageCount: 2,
      tailMessage: { id: "assistant-1", role: "assistant", parentID: "user-1", time: { created: 10 } },
      tailParts: [{ id: "part-1", type: "text", text: "hello" }],
    })
    expect(base).toBe(
      createSessionContentSignature({
        status: "idle",
        updatedAt: 10,
        messageCount: 2,
        tailMessage: { id: "assistant-1", role: "assistant", parentID: "user-1", time: { created: 10 } },
        tailParts: [{ id: "part-1", type: "text", text: "hello" }],
      }),
    )
    expect(base).not.toBe(
      createSessionContentSignature({
        status: "idle",
        updatedAt: 10,
        messageCount: 2,
        tailMessage: { id: "assistant-1", role: "assistant", parentID: "user-1", time: { created: 10 } },
        tailParts: [{ id: "part-1", type: "text", text: "hello again" }],
      }),
    )
  })
})
