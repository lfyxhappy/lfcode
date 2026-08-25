import z from "zod"
import { Effect } from "effect"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { Session } from "@/session"
import { SessionCheckpoint } from "@/session/checkpoint"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Token } from "@/util"
import { countTokens, pressureLevel, usable } from "./overflow"

const Pressure = z.enum(["idle", "monitoring", "checkpoint", "rebuild"])

export const Info = z
  .object({
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
    }),
    checkpoint: z.object({
      exists: z.boolean(),
      writer_running: z.boolean(),
      watermark: MessageID.zod.nullable(),
    }),
    fallback_reason: z.string().nullable(),
  })
  .meta({ ref: "SessionContextStatus" })

export type Info = z.infer<typeof Info>

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
  const last = messages.findLast(
    (message): message is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      message.info.role === "assistant" && message.info.mode !== "compaction",
  )
  const model = last
    ? yield* provider
        .getModel(last.info.providerID, last.info.modelID)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined
  const cfg = yield* config.get()
  const projection = MessageV2.projectActiveContext(messages, {
    tailTurns: cfg.compaction?.tail_turns,
    maxTailTokens: model ? Math.min(64_000, Math.max(4_000, Math.floor(usable({ cfg, model }) * 0.35))) : undefined,
  })
  const level = model && last ? pressureLevel({ cfg, model, tokens: last.info.tokens }) : 0

  return {
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
    },
    checkpoint: {
      exists: yield* checkpoint.hasCheckpoint(sessionID),
      writer_running: yield* checkpoint.isWriterRunning(sessionID),
      watermark: (yield* checkpoint.lastBoundary(sessionID)) ?? null,
    },
    fallback_reason: continuation.fallbackReason ?? null,
  } satisfies Info
})

export * as SessionContextStatus from "./context-status"
