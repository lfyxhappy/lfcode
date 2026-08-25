import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "@lfcode-ai/sdk/v2/client"
import { formatResponseTokenCount, getTurnResponseMetricsLine } from "./session-turn-response-metrics"

const labels = {
  ended: "Ended",
  first: "First",
  total: "Total",
  input: "Input",
  output: "Output",
  tokens: "Tokens",
  in: "In",
  out: "Out",
  hit: "Hit",
  write: "Write",
  tps: "TPS",
}

function assistant(input: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: input.id ?? "assistant-1",
    sessionID: input.sessionID ?? "session-1",
    role: "assistant",
    time: input.time ?? { created: 0, completed: 5_000 },
    parentID: input.parentID ?? "user-1",
    modelID: input.modelID ?? "model-1",
    providerID: input.providerID ?? "provider-1",
    mode: input.mode ?? "build",
    agent: input.agent ?? "build",
    path: input.path ?? { cwd: "/", root: "/" },
    cost: input.cost ?? 0,
    tokens:
      input.tokens ??
      ({
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      } satisfies AssistantMessage["tokens"]),
    ...input,
  }
}

describe("session turn response metrics", () => {
  test("formats response token counts with adaptive K, M, and B units", () => {
    expect(formatResponseTokenCount(505, "en")).toBe("505")
    expect(formatResponseTokenCount(1_500, "en")).toBe("1.5K")
    expect(formatResponseTokenCount(1_500_000, "en")).toBe("1.5M")
    expect(formatResponseTokenCount(1_500_000_000, "en")).toBe("1.5B")
  })

  test("formats a completed turn summary", () => {
    const finishedAt = Date.UTC(2026, 0, 1, 10, 0, 5)
    const line = getTurnResponseMetricsLine({
      locale: "en",
      labels,
      startedAt: finishedAt - 5_000,
      messages: [
        assistant({
          responseMetrics: {
            firstTokenAt: finishedAt - 4_000,
            tokens: {
              total: 8,
              input: 5,
              output: 2,
              reasoning: 1,
              cache: { read: 1, write: 1 },
            },
          },
        }),
        assistant({
          id: "assistant-2",
          time: { created: finishedAt - 2_000, completed: finishedAt },
          responseMetrics: {
            firstTokenAt: finishedAt - 2_000,
            tokens: {
              total: 12,
              input: 7,
              output: 3,
              reasoning: 0,
              cache: { read: 2, write: 3 },
            },
          },
        }),
      ],
    })

    const expectedTime = new Intl.DateTimeFormat("en", { timeStyle: "medium" }).format(finishedAt)
    expect(line).toBe(
      `Ended ${expectedTime} · First 1s / Total 5s · Output 1.5 TPS · Tokens 25 (In 12 / Out 6 / Hit 3 / Write 4)`,
    )
  })

  test("omits input TPS and computes output TPS after first token", () => {
    const finishedAt = Date.UTC(2026, 0, 1, 10, 0, 5)
    const line = getTurnResponseMetricsLine({
      locale: "en",
      labels,
      startedAt: finishedAt - 5_000,
      messages: [
        assistant({
          time: { created: finishedAt - 2_000, completed: finishedAt },
          responseMetrics: {
            firstTokenAt: finishedAt - 2_000,
            tokens: {
              total: 12,
              input: 9,
              output: 3,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        }),
      ],
    })

    expect(line).toBeDefined()
    expect(line).toContain("Output 1.5 TPS")
    expect(line).not.toContain("Input")
  })

  test("returns undefined when metrics are missing", () => {
    const line = getTurnResponseMetricsLine({
      locale: "en",
      labels,
      startedAt: 0,
      messages: [assistant()],
    })

    expect(line).toBeUndefined()
  })

  test("returns undefined for streaming or failed turns", () => {
    const streaming = getTurnResponseMetricsLine({
      locale: "en",
      labels,
      startedAt: 0,
      messages: [
        assistant({
          time: { created: 0 },
          responseMetrics: {
            firstTokenAt: 1_000,
            tokens: {
              total: 10,
              input: 4,
              output: 4,
              reasoning: 0,
              cache: { read: 2, write: 0 },
            },
          },
        }),
      ],
    })
    const failed = getTurnResponseMetricsLine({
      locale: "en",
      labels,
      startedAt: 0,
      messages: [
        assistant({
          error: {
            name: "MessageAbortedError",
            data: { message: "aborted" },
          },
          responseMetrics: {
            firstTokenAt: 1_000,
            tokens: {
              total: 10,
              input: 4,
              output: 4,
              reasoning: 0,
              cache: { read: 2, write: 0 },
            },
          },
        }),
      ],
    })

    expect(streaming).toBeUndefined()
    expect(failed).toBeUndefined()
  })
})
