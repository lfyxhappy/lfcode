import type { AssistantMessage, Message } from "@lfcode-ai/sdk/v2/client"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"
export { formatTokenCount } from "@lfcode-ai/shared/token-format"

export const TPS_WINDOW_MS = 5_000
// Keep extra history so sparse provider updates still retain a sample before the window cutoff.
export const TPS_SAMPLE_RETENTION_MS = TPS_WINDOW_MS * 2
const MIN_AVERAGE_ELAPSED_MS = 300

// This is a fallback for providers that only report usage at finish-step.
// It is intentionally category-aware: CJK characters and symbols are usually
// token-sized, while ASCII words are split into smaller subword-like chunks.
export function estimateTextTokens(input: string) {
  let tokens = 0
  let asciiRun = 0
  const flushAscii = () => {
    if (asciiRun > 0) tokens += Math.ceil(asciiRun / 4)
    asciiRun = 0
  }

  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (/^[A-Za-z0-9]$/.test(char)) {
      asciiRun++
      continue
    }
    flushAscii()
    if (/\s/u.test(char)) continue
    if ((code >= 0x1f300 && code <= 0x1faff) || code > 0xffff) {
      tokens += 2
      continue
    }
    tokens += 1
  }
  flushAscii()
  return tokens
}

export type TokenSample = {
  at: number
  tokens: number
  estimated?: boolean
}

type TokenCounts = AssistantMessage["tokens"]

function totalTokens(tokens: TokenCounts) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function latestTokens(message: AssistantMessage) {
  const snapshot = message.responseMetrics?.tokens
  if (!snapshot) return totalTokens(message.tokens)

  return totalTokens({
    input: Math.max(message.tokens.input, snapshot.input),
    output: Math.max(message.tokens.output, snapshot.output),
    reasoning: Math.max(message.tokens.reasoning, snapshot.reasoning),
    cache: {
      read: Math.max(message.tokens.cache.read, snapshot.cache.read),
      write: Math.max(message.tokens.cache.write, snapshot.cache.write),
    },
  })
}

function latestGeneratedTokens(message: AssistantMessage) {
  const snapshot = message.responseMetrics?.tokens
  return Math.max(
    message.tokens.output + message.tokens.reasoning,
    snapshot ? snapshot.output + snapshot.reasoning : 0,
  )
}

function latestAssistant(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "assistant") return message
  }
}

export function mergeSessionPerformanceMessages(loaded: Message[], history: Message[]) {
  const merged = new Map(history.map((message) => [message.id, message]))
  for (const message of loaded) merged.set(message.id, message)
  return [...merged.values()].sort((left, right) => {
    const created = left.time.created - right.time.created
    return created || left.id.localeCompare(right.id)
  })
}

function streamingTps(message: AssistantMessage, samples: TokenSample[] | undefined, now: number, generatedTokens: number) {
  if (message.time.completed || message.error) return null
  const ordered = (samples ?? [])
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.tokens) && sample.at <= now)
    .sort((left, right) => left.at - right.at)
  const mode = ordered.at(-1)?.estimated
  const cutoff = now - TPS_WINDOW_MS
  const baseline = [...ordered].reverse().find((sample) => sample.at <= cutoff && sample.estimated === mode)
  const startedAt = Math.max(message.time.created, message.responseMetrics?.firstTokenAt ?? message.time.created)
  const baselineAt = baseline?.at ?? startedAt
  const baselineTokens = baseline?.tokens ?? 0
  const currentTokens = Math.max(generatedTokens, ordered.at(-1)?.tokens ?? 0)
  if (currentTokens <= 0) return 0
  const elapsed = now - baselineAt
  const delta = currentTokens - baselineTokens
  if (!Number.isFinite(elapsed) || elapsed < MIN_AVERAGE_ELAPSED_MS || delta <= 0) return 0
  return delta / (elapsed / 1000)
}

function completedTps(message: AssistantMessage, generatedTokens: number) {
  if (!message.time.completed || message.error || generatedTokens <= 0) return null
  const startedAt = Math.max(message.time.created, message.responseMetrics?.firstTokenAt ?? message.time.created)
  const elapsed = message.time.completed - startedAt
  if (!Number.isFinite(elapsed) || elapsed < MIN_AVERAGE_ELAPSED_MS) return 0
  return generatedTokens / (elapsed / 1000)
}

export function getSessionPerformanceMetrics(input: {
  messages?: Message[]
  tokenSamplesByMessageID?: Record<string, TokenSample[] | undefined>
  estimatedOutputTokensByMessageID?: Record<string, number | undefined>
  now: number
  usageTotalTokens?: number | null
  usageReady?: boolean
}) {
  const messages = mergeSessionPerformanceMessages(input.messages ?? [], [])
  const current = latestAssistant(messages)
  const localConversationTokens = messages.reduce(
    (total, message) => total + (message.role === "assistant" ? latestTokens(message) : 0),
    0,
  )
  const estimatedOutput = current ? input.estimatedOutputTokensByMessageID?.[current.id] ?? 0 : 0
  const generatedTokens = current ? Math.max(latestGeneratedTokens(current), estimatedOutput) : 0
  const currentTokens = current ? Math.max(latestTokens(current), estimatedOutput) : 0
  const streaming = current ? !current.time.completed && !current.error : false
  const conversationTokens =
    input.usageReady !== undefined
      ? input.usageReady && typeof input.usageTotalTokens === "number"
        ? input.usageTotalTokens + (streaming ? currentTokens : 0)
        : null
      : localConversationTokens

  if (!current) {
    return { currentTokens: 0, conversationTokens, tps: null, streaming: false }
  }

  return {
    currentTokens,
    conversationTokens,
    tps: streaming
      ? streamingTps(current, input.tokenSamplesByMessageID?.[current.id], input.now, generatedTokens)
      : completedTps(current, generatedTokens),
    streaming,
  }
}
