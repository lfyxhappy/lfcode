import z from "zod"
import { SessionID } from "./schema"

export const MAIN_CONTEXT_AGENT_ID = "main"

export const Snapshot = z.object({
  sessionID: SessionID.zod,
  agentID: z.string().min(1),
  activeContextTokens: z.number().int().nonnegative(),
  contextWindowTokens: z.number().int().positive().nullable(),
  providerID: z.string().nullable(),
  modelID: z.string().nullable(),
  measuredAt: z.number().int().nonnegative(),
  measurementSource: z.string().default("request_envelope"),
})
export type Snapshot = z.infer<typeof Snapshot>

export function isMainContextAgent(agentID: string | undefined) {
  return agentID === undefined || agentID === MAIN_CONTEXT_AGENT_ID
}

export function shouldPersistSnapshot(snapshot: Pick<Snapshot, "agentID">) {
  return snapshot.agentID === MAIN_CONTEXT_AGENT_ID
}

export function snapshotMetrics(activeContextTokens: number, contextWindowTokens: number | null) {
  if (contextWindowTokens === null || contextWindowTokens <= 0) {
    return { contextPercentage: null, remainingContextTokens: null }
  }
  const rawPercentage = (activeContextTokens / contextWindowTokens) * 100
  return {
    // Keep one decimal place so small but real usage in million-token windows
    // does not collapse to the same visual value as an empty or stale status.
    contextPercentage: Math.min(100, Math.max(0, Math.round(rawPercentage * 10) / 10)),
    remainingContextTokens: Math.max(0, contextWindowTokens - activeContextTokens),
  }
}

export function requestInputTokens(tokens: { input: number; cache: { read: number; write: number } }) {
  return tokens.input + tokens.cache.read + tokens.cache.write
}

export function snapshotMeasurement(
  tokens: { input: number; cache: { read: number; write: number } },
  fallback: number | undefined,
) {
  // Compaction uses the provider's input/cache accounting. Keep the visible
  // context metric on that same source once a response has returned; the
  // request envelope only fills the gap before a provider reports usage.
  const providerTokens = requestInputTokens(tokens)
  if (providerTokens > 0) return { activeContextTokens: providerTokens, measurementSource: "provider" as const }
  if (fallback !== undefined) {
    return { activeContextTokens: fallback, measurementSource: "request_envelope" as const }
  }
  return
}
