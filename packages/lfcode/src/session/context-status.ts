import z from "zod"
import { Effect, Exit } from "effect"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { Session } from "@/session"
import { SessionCheckpoint } from "@/session/checkpoint"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Token } from "@/util"
import { Database, and, eq, isNull, or } from "@/storage"
import {
  MAIN_CONTEXT_AGENT_ID,
  Snapshot,
  requestInputTokens,
  snapshotMeasurement,
  snapshotMetrics,
} from "./context-snapshot"
import { SessionContextStatusTable } from "./context-status.sql"
import { countTokens, pressureLevel, usable } from "./overflow"

const Pressure = z.enum(["idle", "monitoring", "checkpoint", "rebuild"])

export const Info = z
  .object({
    active_context_tokens: z.number(),
    context_window_tokens: z.number().nullable(),
    context_percentage: z.number().nullable(),
    remaining_context_tokens: z.number().nullable(),
    provider_id: z.string().nullable(),
    model_id: z.string().nullable(),
    measured_at: z.number().nullable(),
    measurement_source: z.string(),
    // `true` means the persisted observation was superseded by newer main
    // conversation activity or a model change. The returned token count is a
    // deterministic fallback estimate in that case, while the original
    // measurement timestamp remains available for diagnostics.
    snapshot_stale: z.boolean(),
    snapshot_age_ms: z.number().nullable(),
    usable_tokens: z.number().nullable(),
    used_tokens: z.number(),
    pressure: Pressure,
    source: z.enum(["raw", "checkpoint", "compaction"]),
    boundary: z
      .object({
        message_id: MessageID.zod,
        kind: z.enum(["checkpoint", "compaction"]),
        valid: z.boolean(),
      })
      .nullable(),
    tail_tokens: z.number(),
    projection: z.object({
      media: z.number(),
      reasoning: z.number(),
      tool_results: z.number(),
      media_tokens: z.number(),
      reasoning_tokens: z.number(),
      tool_result_tokens: z.number(),
      message_tokens: z.number(),
      other_tokens: z.number(),
    }),
    cache_hit_rate: z.number().nullable(),
    checkpoint: z.object({
      exists: z.boolean(),
      writer_running: z.boolean(),
      watermark: MessageID.zod.nullable(),
    }),
    fallback_reason: z.string().nullable(),
  })
  .meta({ ref: "SessionContextStatus" })

export type Info = z.infer<typeof Info>

export { Snapshot, requestInputTokens, snapshotMeasurement, snapshotMetrics }
export { saveSnapshot } from "./context-snapshot-store"

function readSnapshot(sessionID: SessionID) {
  const row = Database.use((db) => {
    try {
      return db
        .select()
        .from(SessionContextStatusTable)
        .where(
          and(
            eq(SessionContextStatusTable.session_id, sessionID),
            or(eq(SessionContextStatusTable.agent_id, MAIN_CONTEXT_AGENT_ID), isNull(SessionContextStatusTable.agent_id)),
          ),
        )
        .get()
    } catch {
      // Fresh test/workspace databases can predate this optional snapshot
      // table. Context status must still fall back to the active messages.
      return
    }
  })
  if (!row) return
  return {
    activeContextTokens: row.active_context_tokens,
    contextWindowTokens: row.context_window_tokens,
    providerID: row.provider_id,
    modelID: row.model_id,
    measuredAt: row.measured_at,
    measurementSource: row.measurement_source,
  }
}

type MainSnapshot = NonNullable<ReturnType<typeof readSnapshot>>

function latestMainUser(messages: MessageV2.WithParts[]) {
  return messages.findLast((message): message is MessageV2.WithParts & { info: MessageV2.User } => message.info.role === "user")
}

/** @internal Exported for focused ordering tests. */
export function snapshotIsStale(
  snapshot: MainSnapshot | undefined,
  messages: MessageV2.WithParts[],
  lastAssistant: (MessageV2.WithParts & { info: MessageV2.Assistant }) | undefined,
) {
  if (!snapshot) return false

  // A snapshot is tied to the request that produced it. A later user turn or
  // assistant step means that observation no longer describes the active
  // conversation. The assistant-created timestamp is used instead of the
  // completion timestamp so an in-flight stream invalidates an older snapshot,
  // while the pre-request snapshot for that same assistant remains valid.
  const latestActivityAt = messages.reduce(
    (latest, message) => (message.info.role === "user" ? Math.max(latest, message.info.time.created ?? 0) : latest),
    0,
  )
  if (latestActivityAt > snapshot.measuredAt) return true

  if (lastAssistant && lastAssistant.info.time.created > snapshot.measuredAt) return true

  // Compaction changes the active continuation without changing the original
  // user timestamp. Do not keep showing the pre-compaction request after the
  // summary assistant has been persisted; the fallback estimate will reflect
  // the compacted tail until the next exact request snapshot is written.
  const latestCompaction = messages.findLast(
    (message): message is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      message.info.role === "assistant" && message.info.mode === "compaction",
  )
  if (latestCompaction && latestCompaction.info.time.created > snapshot.measuredAt) return true

  const current = latestModelReference(messages, lastAssistant)
  const currentProvider = current?.providerID
  const currentModel = current?.modelID
  if (currentProvider && currentModel && (snapshot.providerID !== currentProvider || snapshot.modelID !== currentModel)) return true

  return false
}

function modelReference(
  messages: MessageV2.WithParts[],
  lastAssistant: (MessageV2.WithParts & { info: MessageV2.Assistant }) | undefined,
  snapshot: MainSnapshot | undefined,
) {
  const current = latestModelReference(messages, lastAssistant)
  return {
    providerID: current?.providerID ?? snapshot?.providerID,
    modelID: current?.modelID ?? snapshot?.modelID,
  }
}

function latestModelReference(
  messages: MessageV2.WithParts[],
  lastAssistant: (MessageV2.WithParts & { info: MessageV2.Assistant }) | undefined,
) {
  const user = latestMainUser(messages)
  const userIndex = user ? messages.findLastIndex((message) => message.info.id === user.info.id) : -1
  const assistantIndex = lastAssistant
    ? messages.findLastIndex((message) => message.info.id === lastAssistant.info.id)
    : -1
  // Message order is authoritative when timestamps collide (multiple turns can
  // be created within the same millisecond).
  if (user && (!lastAssistant || userIndex > assistantIndex)) return user.info.model
  if (lastAssistant) return { providerID: lastAssistant.info.providerID, modelID: lastAssistant.info.modelID }
  return user?.info.model
}

function estimate(messages: MessageV2.WithParts[]) {
  return messages.reduce((total, message) => {
    try {
      return total + Token.estimate(JSON.stringify(message.parts))
    } catch {
      return total + 1000
    }
  }, 0)
}

function tail(messages: MessageV2.WithParts[], context: MessageV2.ContinuationContext) {
  if (context.source === "raw") return messages
  const boundaryIndex = messages.findIndex((message) => message.info.id === context.boundary?.messageID)
  if (boundaryIndex < 0) return []
  if (context.source === "checkpoint") return messages.slice(boundaryIndex + 1)
  const boundary = messages[boundaryIndex]
  const tailStart = boundary.parts.find((part) => part.type === "compaction")?.tail_start_id
  const tailIndex = tailStart ? messages.findIndex((message) => message.info.id === tailStart) : -1
  return tailIndex >= 0 && tailIndex < boundaryIndex ? messages.slice(tailIndex, boundaryIndex) : []
}

export const get = Effect.fn("SessionContextStatus.get")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  const provider = yield* Provider.Service
  const config = yield* Config.Service
  const checkpoint = yield* SessionCheckpoint.Service
  yield* sessions.get(sessionID)
  const messages = yield* sessions.messages({ sessionID, agentID: "main" })
  const continuation = MessageV2.selectContinuationMessages(messages)
  const snapshot = readSnapshot(sessionID)
  const last = messages.findLast(
    (message): message is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      message.info.role === "assistant" && message.info.mode !== "compaction",
  )
  const snapshotStale = snapshotIsStale(snapshot, messages, last)
  // Prefer the model attached to the latest main message. A previous snapshot
  // may belong to a model that was removed or switched away from.
  const reference = modelReference(messages, last, snapshotStale ? undefined : snapshot)
  const modelExit = reference.providerID && reference.modelID
    ? yield* provider.getModel(reference.providerID, reference.modelID).pipe(Effect.exit)
    : undefined
  const model = modelExit && Exit.isSuccess(modelExit) ? modelExit.value : undefined
  const cfg = yield* config.get()
  // Older sessions may not have a persisted request snapshot yet, and stale
  // snapshots must not mask a newer turn. Use the active continuation as a
  // deterministic fallback estimate in both cases.
  const activeContextTokens = snapshot && !snapshotStale ? snapshot.activeContextTokens : estimate(continuation.messages)
  const contextWindowTokens = snapshot && !snapshotStale ? snapshot.contextWindowTokens : model?.limit.context ?? null
  const contextMetrics = snapshotMetrics(activeContextTokens, contextWindowTokens)
  const projection = MessageV2.projectActiveContext(messages, {
    tailTurns: cfg.compaction?.tail_turns,
    maxTailTokens: model ? Math.min(64_000, Math.max(4_000, Math.floor(usable({ cfg, model }) * 0.35))) : undefined,
  })
  const projectionTokens = messages.reduce(
    (stats, message) => {
      for (const part of message.parts) {
        const tokens = Token.estimate(JSON.stringify(part))
        if (part.type === "reasoning") stats.reasoning += tokens
        else if (part.type === "tool" && part.state.status === "completed") stats.toolResults += tokens
        else if (part.type === "file") stats.media += tokens
        else if (part.type === "text") stats.messages += tokens
        else stats.other += tokens
      }
      return stats
    },
    { media: 0, reasoning: 0, toolResults: 0, messages: 0, other: 0 },
  )
  const cacheTotals = continuation.messages.reduce(
    (totals, message) => {
      if (message.info.role !== "assistant" || message.info.mode === "compaction") return totals
      const tokens = message.info.tokens
      const total = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
      if (total <= 0) return totals
      return { read: totals.read + (tokens.cache?.read ?? 0), total: totals.total + total }
    },
    { read: 0, total: 0 },
  )
  const level = model
    ? pressureLevel({
        cfg,
        model,
        tokens: {
          total: activeContextTokens,
          input: activeContextTokens,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      })
    : 0

  return {
    active_context_tokens: activeContextTokens,
    context_window_tokens: contextWindowTokens,
    context_percentage: contextMetrics.contextPercentage,
    remaining_context_tokens: contextMetrics.remainingContextTokens,
    // Keep the IDs attached to the current main message even when the provider
    // catalog is temporarily unavailable. Never expose an older snapshot model
    // as if it were the active one after a model switch.
    provider_id: model?.providerID ?? reference.providerID ?? null,
    model_id: model?.id ?? reference.modelID ?? null,
    measured_at: snapshot?.measuredAt ?? null,
    measurement_source: snapshot && !snapshotStale ? snapshot.measurementSource : snapshot ? "fallback_estimate" : "none",
    snapshot_stale: snapshotStale,
    snapshot_age_ms: snapshot ? Math.max(0, Date.now() - snapshot.measuredAt) : null,
    usable_tokens: model ? usable({ cfg, model }) : null,
    used_tokens: last ? countTokens(last.info.tokens) : 0,
    pressure: (["idle", "monitoring", "checkpoint", "rebuild"] as const)[level],
    source: continuation.source,
    boundary: continuation.boundary
      ? {
          message_id: continuation.boundary.messageID,
          kind: continuation.boundary.kind,
          valid: continuation.boundary.valid,
        }
      : null,
    tail_tokens: estimate(tail(messages, continuation)),
    projection: {
      media: projection.stats.media,
      reasoning: projection.stats.reasoning,
      tool_results: projection.stats.toolResults,
      media_tokens: projectionTokens.media,
      reasoning_tokens: projectionTokens.reasoning,
      tool_result_tokens: projectionTokens.toolResults,
      message_tokens: projectionTokens.messages,
      other_tokens: projectionTokens.other,
    },
    cache_hit_rate: cacheTotals.total > 0 ? Math.round((cacheTotals.read / cacheTotals.total) * 1000) / 10 : null,
    checkpoint: {
      exists: yield* checkpoint.hasCheckpoint(sessionID),
      writer_running: yield* checkpoint.isWriterRunning(sessionID),
      watermark: (yield* checkpoint.lastBoundary(sessionID)) ?? null,
    },
    fallback_reason:
      [continuation.fallbackReason, snapshotStale ? "context snapshot superseded by newer main activity" : undefined]
        .filter((reason): reason is string => Boolean(reason))
        .join("; ") || null,
  } satisfies Info
})

export * as SessionContextStatus from "./context-status"
