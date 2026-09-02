import { describe, expect, test } from "bun:test"
import { requestInputTokens, snapshotIsStale, snapshotMeasurement, snapshotMetrics } from "../../src/session/context-status"
import type { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"

const providerID = ProviderID.make("provider-a")
const modelID = ModelID.make("model-a")

const message = (info: Record<string, unknown>) => ({ info, parts: [] }) as unknown as MessageV2.WithParts
const assistantInfo = (value: MessageV2.WithParts) =>
  value as unknown as MessageV2.WithParts & { info: MessageV2.Assistant }

describe("SessionContextStatus snapshot metrics", () => {
  test("calculates percentage and remaining full window tokens", () => {
    expect(snapshotMetrics(153_000, 258_000)).toEqual({
      contextPercentage: 59.3,
      remainingContextTokens: 105_000,
    })
  })

  test("clamps over-window usage and handles unknown windows", () => {
    expect(snapshotMetrics(300, 200)).toEqual({ contextPercentage: 100, remainingContextTokens: 0 })
    expect(snapshotMetrics(300, null)).toEqual({ contextPercentage: null, remainingContextTokens: null })
  })

  test("prefers provider input/cache accounting after a response completes", () => {
    expect(requestInputTokens({ input: 100, cache: { read: 20, write: 5 } })).toBe(125)
    expect(snapshotMeasurement({ input: 100, cache: { read: 20, write: 5 } }, 900)).toEqual({
      activeContextTokens: 125,
      measurementSource: "provider",
    })
  })

  test("uses provider accounting when no request envelope is available", () => {
    expect(snapshotMeasurement({ input: 100, cache: { read: 20, write: 5 } }, undefined)).toEqual({
      activeContextTokens: 125,
      measurementSource: "provider",
    })
  })

  test("falls back to the request envelope when provider input is empty", () => {
    expect(snapshotMeasurement({ input: 0, cache: { read: 0, write: 0 } }, 900)).toEqual({
      activeContextTokens: 900,
      measurementSource: "request_envelope",
    })
    expect(snapshotMeasurement({ input: 0, cache: { read: 0, write: 0 } }, undefined)).toBeUndefined()
  })

  test("does not let an empty envelope replace provider usage", () => {
    expect(snapshotMeasurement({ input: 100, cache: { read: 20, write: 5 } }, 0)).toEqual({
      activeContextTokens: 125,
      measurementSource: "provider",
    })
  })

  test("uses an explicit zero request envelope only before provider usage is available", () => {
    expect(snapshotMeasurement({ input: 0, cache: { read: 0, write: 0 } }, 0)).toEqual({
      activeContextTokens: 0,
      measurementSource: "request_envelope",
    })
  })

  test("does not invalidate the same-turn snapshot while its assistant is streaming", () => {
    const user = message({
      role: "user",
      time: { created: 100 },
      model: { providerID, modelID },
    })
    const assistant = message({
      role: "assistant",
      providerID,
      modelID,
      mode: "build",
      time: { created: 200 },
    })
    const snapshot = {
      activeContextTokens: 900,
      contextWindowTokens: 10_000,
      providerID,
      modelID,
      measuredAt: 300,
      measurementSource: "request_envelope",
    }
    expect(snapshotIsStale(snapshot, [user, assistant], assistantInfo(assistant))).toBe(false)
  })

  test("invalidates a snapshot from an older assistant step or compaction", () => {
    const user = message({
      role: "user",
      time: { created: 100 },
      model: { providerID, modelID },
    })
    const assistant = message({
      role: "assistant",
      providerID,
      modelID,
      mode: "build",
      time: { created: 200 },
    })
    const snapshot = {
      activeContextTokens: 900,
      contextWindowTokens: 10_000,
      providerID,
      modelID,
      measuredAt: 150,
      measurementSource: "request_envelope",
    }
    expect(snapshotIsStale(snapshot, [user, assistant], assistantInfo(assistant))).toBe(true)

    const compaction = message({
      role: "assistant",
      providerID,
      modelID,
      mode: "compaction",
      time: { created: 250 },
    })
    expect(snapshotIsStale({ ...snapshot, measuredAt: 220 }, [user, assistant, compaction], assistantInfo(assistant))).toBe(true)
  })
})
