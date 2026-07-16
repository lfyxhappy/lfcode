import { Token } from "../../../../../util"

const MIN_STREAMING_ELAPSED_SEC = 0.5
const MIN_COMPLETED_ELAPSED_SEC = 0.001

function generationStartedAt(startedAt: number, firstTokenAt?: number) {
  if (firstTokenAt == null) return startedAt
  return firstTokenAt < startedAt ? startedAt : firstTokenAt
}

function elapsedSec(startedAt: number, firstTokenAt: number | undefined, endedAt: number) {
  return (endedAt - generationStartedAt(startedAt, firstTokenAt)) / 1000
}

export function streamingTPS(
  combinedText: string,
  startedAt: number,
  firstTokenAt: number | undefined,
  now: number,
): number | null {
  const tokens = Token.estimate(combinedText)
  if (tokens === 0) return null
  const elapsed = elapsedSec(startedAt, firstTokenAt, now)
  if (elapsed < MIN_STREAMING_ELAPSED_SEC) return null
  return tokens / elapsed
}

export function completedTPS(
  outputTokens: number,
  reasoningTokens: number,
  startedAt: number,
  firstTokenAt: number | undefined,
  completedAt: number,
): number | null {
  const tokens = outputTokens + reasoningTokens
  if (tokens === 0) return null
  const elapsed = elapsedSec(startedAt, firstTokenAt, completedAt)
  if (elapsed < MIN_COMPLETED_ELAPSED_SEC) return null
  return tokens / elapsed
}

export function formatTPS(tps: number | null): string | null {
  if (tps === null) return null
  if (tps < 1) return "<1 t/s"
  return `${Math.round(tps)} t/s`
}
