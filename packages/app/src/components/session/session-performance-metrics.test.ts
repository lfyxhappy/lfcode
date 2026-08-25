import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message } from "@lfcode-ai/sdk/v2/client"
import { estimateTextTokens, formatTokenCount, getSessionPerformanceMetrics } from "./session-performance-metrics"

function assistant(input: Partial<AssistantMessage> & Pick<AssistantMessage, "id">): AssistantMessage {
  const { time, tokens, ...rest } = input
  return {
    ...rest,
    id: input.id,
    sessionID: "session",
    role: "assistant",
    time: { created: 1_000, ...time },
    parentID: "user",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "agent",
    path: { cwd: "C:/", root: "C:/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, ...tokens },
  }
}

describe("getSessionPerformanceMetrics", () => {
  test("formats token counts with raw, K, M, and B units", () => {
    expect(formatTokenCount(505)).toBe("505")
    expect(formatTokenCount(1_500)).toBe("1.5K")
    expect(formatTokenCount(1_500_000)).toBe("1.5M")
    expect(formatTokenCount(1_500_000_000)).toBe("1.5B")
  })

  test("returns the empty-session state", () => {
    expect(getSessionPerformanceMetrics({ now: 2_000 })).toEqual({ currentTokens: 0, conversationTokens: 0, tps: null, streaming: false })
  })

  test("shows the latest completed request average TPS", () => {
    const message = assistant({ id: "one", time: { created: 1_000, completed: 2_000 }, tokens: { input: 3, output: 4, reasoning: 5, cache: { read: 6, write: 7 } } })
    expect(getSessionPerformanceMetrics({ messages: [message], now: 3_000 })).toEqual({ currentTokens: 25, conversationTokens: 25, tps: 9, streaming: false })
  })

  test("uses first-token time for the completed average when available", () => {
    const message = assistant({
      id: "one",
      time: { created: 1_000, completed: 3_000 },
      responseMetrics: { firstTokenAt: 2_000, tokens: { input: 0, output: 12, reasoning: 3, cache: { read: 0, write: 0 } } },
    })
    expect(getSessionPerformanceMetrics({ messages: [message], now: 4_000 })).toMatchObject({ tps: 15, streaming: false })
  })

  test("sums all assistant requests in the conversation", () => {
    const messages: Message[] = [
      assistant({ id: "one", tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } }),
      assistant({ id: "two", tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    expect(getSessionPerformanceMetrics({ messages, now: 3_000 })).toMatchObject({ currentTokens: 7, conversationTokens: 10 })
  })

  test("does not infer a complete total from a partially loaded timeline", () => {
    const loaded = [
      assistant({ id: "new", time: { created: 1_000, completed: 2_000 }, tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    expect(getSessionPerformanceMetrics({ messages: loaded, usageReady: false, now: 3_000 })).toMatchObject({ conversationTokens: null })
  })

  test("uses the server aggregate when the timeline only contains a partial session", () => {
    const loaded = [
      assistant({ id: "new", time: { created: 1_000, completed: 2_000 }, tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    expect(
      getSessionPerformanceMetrics({ messages: loaded, usageReady: true, usageTotalTokens: 1_027, now: 3_000 }),
    ).toMatchObject({ conversationTokens: 1_027 })
  })

  test("does not fall back to a partial local total when the server aggregate is unavailable", () => {
    const loaded = [assistant({ id: "new", tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } })]
    expect(getSessionPerformanceMetrics({ messages: loaded, usageReady: false, now: 3_000 })).toMatchObject({ conversationTokens: null })
  })

  test("adds only the active request while the server aggregate is waiting for persistence", () => {
    const message = assistant({
      id: "one",
      responseMetrics: { firstTokenAt: 1_000, tokens: { input: 3, output: 4, reasoning: 5, cache: { read: 6, write: 7 } } },
    })
    expect(
      getSessionPerformanceMetrics({ messages: [message], usageReady: true, usageTotalTokens: 100, now: 2_000 }),
    ).toMatchObject({ currentTokens: 25, conversationTokens: 125 })
  })

  test("calculates average TPS from the current generation window", () => {
    const message = assistant({ id: "one", responseMetrics: { firstTokenAt: 1_000, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        tokenSamplesByMessageID: { one: [{ at: 1_000, tokens: 10 }, { at: 1_500, tokens: 20 }, { at: 2_000, tokens: 35 }] },
        now: 2_000,
      }),
    ).toMatchObject({ tps: 35, streaming: true })
  })

  test("includes reasoning and cache token values", () => {
    const message = assistant({ id: "one", tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } } })
    expect(getSessionPerformanceMetrics({ messages: [message], now: 3_000 })).toMatchObject({ currentTokens: 15, conversationTokens: 15 })
  })

  test("reports zero estimated TPS before output arrives or after five seconds without growth", () => {
    const message = assistant({ id: "one" })
    expect(getSessionPerformanceMetrics({ messages: [message], now: 3_000 }).tps).toBe(0)
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        tokenSamplesByMessageID: { one: [{ at: 1_000, tokens: 1 }, { at: 2_000, tokens: 10 }, { at: 6_000, tokens: 10 }] },
        now: 7_000,
      }).tps,
    ).toBe(0)
  })

  test("estimates mixed-language and code text without the old chars-divided-by-four bias", () => {
    expect(estimateTextTokens("你好，良风")).toBe(5)
    expect(estimateTextTokens("const value = foo_bar(123);\n")).toBeGreaterThan(5)
    expect(estimateTextTokens("hello world")).toBe(4)
  })

  test("uses estimated generated tokens while provider usage is unavailable", () => {
    const message = assistant({ id: "one", responseMetrics: { firstTokenAt: 1_000, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    expect(
      getSessionPerformanceMetrics({ messages: [message], estimatedOutputTokensByMessageID: { one: 12 }, now: 2_000 }),
    ).toMatchObject({ currentTokens: 12, streaming: true })
  })

  test("calculates a baseline average TPS before five seconds of output", () => {
    const message = assistant({ id: "one", responseMetrics: { firstTokenAt: 1_000, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        tokenSamplesByMessageID: { one: [{ at: 1_500, tokens: 10, estimated: true }] },
        now: 1_500,
      }),
    ).toMatchObject({ tps: 20, currentTokens: 0, streaming: true })
  })

  test("uses only the latest five seconds once a full window is available", () => {
    const message = assistant({ id: "one", responseMetrics: { firstTokenAt: 1_000, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        tokenSamplesByMessageID: {
          one: [
            { at: 1_000, tokens: 10, estimated: true },
            { at: 2_000, tokens: 20, estimated: true },
            { at: 6_000, tokens: 70, estimated: true },
          ],
        },
        now: 7_000,
      }),
    ).toMatchObject({ tps: 10, streaming: true })
  })

  test("uses the text and reasoning estimate for the active request", () => {
    const message = assistant({ id: "one" })
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        estimatedOutputTokensByMessageID: { one: 18 },
        now: 2_000,
      }),
    ).toMatchObject({ currentTokens: 18, streaming: true })
  })

  test("keeps the average TPS stable when samples stop changing briefly", () => {
    const message = assistant({ id: "one", responseMetrics: { firstTokenAt: 1_000, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    expect(
      getSessionPerformanceMetrics({
        messages: [message],
        tokenSamplesByMessageID: { one: [{ at: 1_000, tokens: 20, estimated: true }] },
        estimatedOutputTokensByMessageID: { one: 635 },
        now: 2_500,
      }),
    ).toMatchObject({ tps: 423.3333333333333, currentTokens: 635, streaming: true })
  })
})
