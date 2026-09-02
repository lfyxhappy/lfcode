import { Cause, Deferred, Effect, Layer, Context, Scope } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { SYSTEM_SPAWNED_AGENT_TYPES } from "@/agent/config"
import { Bus } from "@/bus"
import { Metrics } from "@/metrics"
import { Config } from "@/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import { SessionInteraction } from "./interaction"
import { Goal } from "./goal"
import type { Provider } from "@/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { Log } from "@/util"
import { isRecord } from "@/util/record"
import { redactSensitiveText } from "@/util/redact"
import { classifyValidationError } from "@/tool/tool"
import { nativeWebSearchToolOutput } from "@/tool/websearch/native-result"
import { sameToolFailureCount } from "./part-helpers"
import { isUserHiddenSystemActorID } from "@/actor/visibility"
import { snapshotMeasurement } from "./context-snapshot"

const DOOM_LOOP_THRESHOLD = 3
const REDACTION_TAIL_CHARS = 128
const log = Log.create({ service: "session.processor" })

export type Result = "overflow" | "stop" | "continue"

export type Event = LLM.Event

/**
 * A proposed tool call captured from a candidate stream (max mode), before
 * any execution. `input` is the parsed tool arguments.
 */
export type ProposedToolCall = {
  toolCallId: string
  toolName: string
  input: Record<string, any>
  providerMetadata?: Record<string, any>
}

/**
 * The winning candidate selected by the judge in max mode. Captures the full
 * reasoning + text + proposed tool calls of one candidate stream so the
 * processor can replay it: lay down the reasoning/text parts and actually
 * execute the tool calls via the execute-bearing tools.
 */
export type ReplayInput = {
  reasoning?: string
  reasoningMetadata?: Record<string, any>
  text?: string
  textMetadata?: Record<string, any>
  toolCalls: ProposedToolCall[]
  finishReason: string
  usage?: any
  providerMetadata?: Record<string, any>
  /** Execute-bearing tools (from resolveTools) used to run the winner's calls. */
  tools: Record<string, { execute?: (input: any, options: any) => Promise<any> }>
  /** Model messages passed to tool execute contexts. */
  messages: any[]
  /**
   * Max-mode selection metadata. When set, a short note is prepended to the
   * replayed reasoning so the user can see the ensemble happened and which
   * candidate won. `winner` is 0-based.
   */
  selection?: { winner: number; total: number }
  /**
   * Real wall-clock duration (ms) the winning candidate spent thinking, so the
   * replayed reasoning part shows a meaningful duration instead of the ~1ms
   * synthetic replay time. Optional.
   */
  thinkingMs?: number
  /**
   * Max-mode ensemble overhead: the cost and token counts of the losing
   * candidates + the judge call. These are real spend but consume NO context,
   * so they are added to `cost` and the ModelCall metric ONLY — never to the
   * message's `tokens`, which must stay the winner's real footprint so context
   * overflow / prune estimation stays correct.
   */
  overhead?: { cost: number; tokensIn: number; tokensOut: number }
  requestEnvelopeTokens?: number
  /** Session-run cancellation signal shared with candidates and judge. */
  abortSignal?: AbortSignal
}

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
  /**
   * Replay a pre-selected candidate (max mode): synthesize the stream events a
   * real model call would have produced for the winner — reasoning, text, then
   * each tool call (input-start → call → execute → result) — and run them
   * through the same event handler used by `process`. Tool execution, snapshot
   * tracking, permission asks and metrics are all reused. Returns the same
   * Result contract as `process`.
   */
  readonly replay: (input: ReplayInput) => Effect.Effect<Result>
}

export type AgentMetrics = {
  tokens_in: number
  tokens_out: number
  files_changed: number
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
  submitAt?: number
  agentMetrics?: AgentMetrics
  manageSessionStatus?: boolean
  requestEnvelopeTokens?: number
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

function emptyResponseTokens(): MessageV2.Assistant["tokens"] {
  return {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cache: {
      read: 0,
      write: 0,
    },
  }
}

function addTokens(
  current: MessageV2.Assistant["tokens"],
  next: MessageV2.Assistant["tokens"],
): MessageV2.Assistant["tokens"] {
  return {
    total: (current.total ?? 0) + (next.total ?? 0),
    input: current.input + next.input,
    output: current.output + next.output,
    reasoning: current.reasoning + next.reasoning,
    cache: {
      read: current.cache.read + next.cache.read,
      write: current.cache.write + next.cache.write,
    },
  }
}

function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsOverflowHandling: boolean
  submitAt: number | undefined
  streamStartedAt: number | undefined
  firstDeltaAt: number | undefined
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  stepStartedAt: number | undefined
  stepFirstTokenAt: number | undefined
  stepFinished: boolean
  responseFirstTokenAt: number | undefined
  responseTokens: MessageV2.Assistant["tokens"]
  stepPartIds: PartID[]
  pendingText: string
  /**
   * Wall-clock anchor for the request represented by the current assistant.
   * Completion can happen out of order, so snapshots must use request order,
   * never the time at which a provider stream happens to finish.
   */
  requestEnvelopeMeasuredAt: number | undefined
}

type StreamEvent = Event

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionProcessor") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Session.Service
  | Config.Service
  | Bus.Service
  | Agent.Service
  | LLM.Service
  | Permission.Service
  | Plugin.Service
  | Goal.Service
  | SessionSummary.Service
  | SessionStatus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const goal = yield* Goal.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        agentMetrics: input.agentMetrics,
        requestEnvelopeTokens: input.requestEnvelopeTokens,
        requestEnvelopeMeasuredAt:
          input.requestEnvelopeTokens !== undefined ? input.assistantMessage.time.created : undefined,
        toolcalls: {},
        shouldBreak: false,
        snapshot: undefined,
        blocked: false,
        needsOverflowHandling: false,
        submitAt: input.submitAt,
        streamStartedAt: undefined,
        firstDeltaAt: undefined,
        currentText: undefined,
        reasoningMap: {},
        stepStartedAt: undefined,
        stepFirstTokenAt: undefined,
        stepFinished: false,
        responseFirstTokenAt: undefined,
        responseTokens: emptyResponseTokens(),
        stepPartIds: [],
        pendingText: "",
      }
      let aborted = false
      let activeAbortSignal: AbortSignal | undefined
      // Only the main agent owns session-level status. Subagents (explore,
      // general, checkpoint-writer, etc.) share the parent sessionID but their
      // run-state onIdle deliberately does NOT reset status (run-state.ts) — so
      // if a subagent's stream sets session status here, nothing ever clears it
      // and the TUI spinner stays spinning after the main agent has finished.
      const isMain = !ctx.assistantMessage.agentID || ctx.assistantMessage.agentID === "main"
      // Prompt loop runs under SessionRunState, so the runner owns busy/idle.
      // Direct processor callers (tests, compaction) still rely on processor-
      // managed status and keep the historical default.
      const manageSessionStatus = input.manageSessionStatus ?? true
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id)

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const syncResponseMetrics = () => {
        if (!ctx.responseFirstTokenAt) {
          delete ctx.assistantMessage.responseMetrics
          return
        }
        ctx.assistantMessage.responseMetrics = {
          firstTokenAt: ctx.responseFirstTokenAt,
          tokens: ctx.responseTokens,
        }
      }

      const syncFirstResponseMetrics = Effect.fn("SessionProcessor.syncFirstResponseMetrics")(function* () {
        if (!ctx.responseFirstTokenAt || ctx.assistantMessage.responseMetrics) return
        syncResponseMetrics()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const beginTextPart = Effect.fn("SessionProcessor.beginTextPart")(function* (providerMetadata?: Record<string, any>) {
        ctx.pendingText = ""
        ctx.currentText = {
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "text",
          text: "",
          time: { start: Date.now() },
          metadata: providerMetadata,
        }
        yield* session.updatePart(ctx.currentText)
        ctx.stepPartIds.push(ctx.currentText.id)
      })

      const syncInteractiveWaiting = Effect.fn("SessionProcessor.syncInteractiveWaiting")(function* () {
        if (!isMain || ctx.assistantMessage.error) return
        const current = yield* session.get(ctx.sessionID)
        if (current.interaction?.mode === "interactive-html") return
        const text = MessageV2.parts(ctx.assistantMessage.id)
          .filter((part): part is MessageV2.TextPart => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (!SessionInteraction.containsInteractiveHtmlBlock(text)) return
        yield* session.setInteraction({
          sessionID: ctx.sessionID,
          interaction: {
            mode: "interactive-html",
          },
        })
      })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const stepStatus = (error: NonNullable<MessageV2.Assistant["error"]> | undefined) => {
        if (error?.name === "MessageAbortedError") return "aborted" as const
        if (error) return "error" as const
        return "completed" as const
      }

      const stepTime = () => {
        const start = ctx.stepStartedAt ?? ctx.assistantMessage.time.created ?? Date.now()
        const end = Date.now()
        return {
          start,
          end,
          ttft: ctx.stepStartedAt && ctx.stepFirstTokenAt ? Math.max(0, ctx.stepFirstTokenAt - ctx.stepStartedAt) : null,
          submit_to_first_delta:
            ctx.submitAt && ctx.firstDeltaAt ? Math.max(0, ctx.firstDeltaAt - ctx.submitAt) : null,
          pre_stream: ctx.submitAt && ctx.streamStartedAt ? Math.max(0, ctx.streamStartedAt - ctx.submitAt) : null,
        }
      }

      const writeStepFinish = Effect.fn("SessionProcessor.writeStepFinish")(function* (input: {
        reason: string
        status: "completed" | "error" | "aborted"
        usage: {
          cost: number
          tokens: MessageV2.Assistant["tokens"]
        }
        overhead?: { cost: number; tokensIn: number; tokensOut: number }
      }) {
        ctx.stepFinished = true
        // Direct processor callers (compaction/replay tests and maintenance
        // actors) do not run inside an Instance. The normal prompt path supplies
        // the envelope estimate, which is the canonical context metric. Keep a
        // provider-only fallback for older/replay callers that cannot provide
        // the serialized request envelope.
        const measurement =
          ctx.requestEnvelopeTokens !== undefined || input.status === "completed"
            ? snapshotMeasurement(input.usage.tokens, ctx.requestEnvelopeTokens)
            : undefined
        if (measurement && isMain && ctx.assistantMessage.mode !== "compaction") {
          const { saveSnapshot } = yield* Effect.promise(() => import("./context-snapshot-store"))
          yield* Effect.sync(() =>
            saveSnapshot({
              sessionID: ctx.sessionID,
              agentID: ctx.assistantMessage.agentID ?? "main",
              activeContextTokens: measurement.activeContextTokens,
              contextWindowTokens: ctx.model.limit.context || null,
              providerID: ctx.model.providerID,
              modelID: ctx.model.id,
              // Keep the request's ordering anchor. A late completion from an
              // older request must never replace a newer main-turn snapshot.
              measuredAt: ctx.requestEnvelopeMeasuredAt ?? ctx.assistantMessage.time.created ?? Date.now(),
              measurementSource: measurement.measurementSource,
            }),
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => slog.warn("context snapshot persistence failed", { cause })),
            ),
          )
        }
        yield* session.updatePart({
          id: PartID.ascending(),
          reason: input.reason,
          status: input.status,
          time: stepTime(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "step-finish",
          tokens: input.usage.tokens,
          cost: input.usage.cost,
          ...(input.overhead && (input.overhead.cost > 0 || input.overhead.tokensIn > 0 || input.overhead.tokensOut > 0)
            ? {
                overhead: {
                  cost: input.overhead.cost,
                  tokens: {
                    total: input.overhead.tokensIn + input.overhead.tokensOut,
                    input: input.overhead.tokensIn,
                    output: input.overhead.tokensOut,
                    reasoning: 0,
                    cache: {
                      read: 0,
                      write: 0,
                    },
                  },
                },
              }
            : {}),
        })
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const createMissingToolCall = Effect.fn("SessionProcessor.createMissingToolCall")(function* (input: {
        toolCallID: string
        toolName: string
        toolInput: Record<string, any>
        providerExecuted?: boolean
        error?: unknown
      }) {
        const existing = MessageV2.parts(ctx.assistantMessage.id).find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === input.toolCallID,
        )
        if (existing) {
          if (
            input.error !== undefined &&
            (existing.state.status === "pending" || existing.state.status === "running")
          ) {
            const end = Date.now()
            const start = "time" in existing.state ? existing.state.time.start : end
            yield* session.updatePart({
              ...existing,
              state: {
                status: "error",
                input: existing.state.input,
                error: errorMessage(input.error),
                metadata: {
                  ...(existing.metadata ?? {}),
                  ...(input.providerExecuted ? { providerExecuted: true } : {}),
                },
                time: { start, end },
              },
            })
            yield* settleToolCall(input.toolCallID)
          }
          // Late duplicate provider events must not create a second part for
          // the same call. The first terminal observation remains authoritative.
          return existing
        }
        const now = Date.now()
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.toolName,
          callID: input.toolCallID,
          ...(input.error === undefined
            ? {
                state: {
                  status: "running" as const,
                  input: input.toolInput,
                  time: { start: now },
                },
              }
            : {
                state: {
                  status: "error" as const,
                  input: input.toolInput,
                  error: errorMessage(input.error),
                  ...(input.providerExecuted ? { metadata: { providerExecuted: true } } : {}),
                  time: { start: now, end: now },
                },
              }),
          ...(input.providerExecuted ? { metadata: { providerExecuted: true } } : {}),
        } satisfies MessageV2.ToolPart)
        ctx.stepPartIds.push(part.id)
        if (input.error === undefined) {
          ctx.toolcalls[input.toolCallID] = {
            done: yield* Deferred.make<void>(),
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || (match.part.state.status !== "running" && match.part.state.status !== "pending")) return
        const startedAt = "time" in match.part.state ? match.part.state.time.start : Date.now()
        const completed =
          match.part.tool === "native_web_search"
            ? nativeWebSearchToolOutput({ action: match.part.state.input, output })
            : output
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: completed.output,
            metadata: completed.metadata,
            title: completed.title,
            time: { start: startedAt, end: Date.now() },
            attachments: "attachments" in completed ? completed.attachments : undefined,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || (match.part.state.status !== "running" && match.part.state.status !== "pending")) return false
        const startedAt = "time" in match.part.state ? match.part.state.time.start : Date.now()
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            metadata:
              (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) && ctx.shouldBreak
                ? { blocked: true }
                : undefined,
            time: { start: startedAt, end: Date.now() },
          },
        })
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        // A provider can still yield buffered SSE chunks after its fetch has
        // been aborted. Never let a detached runner append those chunks to the
        // message selected by a later session run.
        if (activeAbortSignal?.aborted) return
        switch (value.type) {
          case "start":
            ctx.streamStartedAt = Date.now()
            if (isMain && manageSessionStatus) yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              // Replayed candidates (max mode) carry a backdated start so the
              // displayed thinking duration reflects the real candidate latency
              // instead of the ~1ms synthetic replay. Live streams omit `time`.
              time: { start: (value as { time?: { start: number } }).time?.start ?? Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            ctx.stepPartIds.push(ctx.reasoningMap[value.id].id)
            return

          case "reasoning-delta":
            if (!ctx.firstDeltaAt) ctx.firstDeltaAt = Date.now()
            if (!ctx.stepFirstTokenAt) ctx.stepFirstTokenAt = Date.now()
            if (!ctx.responseFirstTokenAt) ctx.responseFirstTokenAt = ctx.stepFirstTokenAt
            yield* syncFirstResponseMetrics()
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (!(value.id in ctx.reasoningMap)) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text
            ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePart(ctx.reasoningMap[value.id])
            delete ctx.reasoningMap[value.id]
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            if (ctx.toolcalls[value.id]) return
            const persisted = MessageV2.parts(ctx.assistantMessage.id).find(
              (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === value.id,
            )
            if (persisted && persisted.state.status !== "pending") return
            const part = yield* session.updatePart({
              id: persisted?.id ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "tool",
              tool: value.toolName,
              callID: value.id,
              state: { status: "pending", input: {}, raw: "" },
              metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
            } satisfies MessageV2.ToolPart)
            ctx.stepPartIds.push(part.id)
            ctx.toolcalls[value.id] = {
              done: yield* Deferred.make<void>(),
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID,
            }
            return

          case "tool-input-delta":
            return

          case "tool-input-end":
            return

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            const existing = yield* readToolCall(value.toolCallId)
            if (existing) {
              if (existing.part.state.status === "completed" || existing.part.state.status === "error") return
              yield* updateToolCall(value.toolCallId, (match) => ({
                ...match,
                tool: value.toolName,
                state: {
                  ...match.state,
                  status: "running",
                  input: value.input,
                  time: { start: Date.now() },
                },
                metadata: match.metadata?.providerExecuted
                  ? { ...value.providerMetadata, providerExecuted: true }
                  : value.providerMetadata,
              }))
            } else {
              yield* createMissingToolCall({
                toolCallID: value.toolCallId,
                toolName: value.toolName,
                toolInput: isRecord(value.input) ? value.input : {},
                providerExecuted: (value as { providerExecuted?: boolean }).providerExecuted,
              })
            }

            const parts = MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.toolName &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(value.input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.toolName],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.toolName, input: value.input },
              always: [value.toolName],
              ruleset: agent.permission,
              // System-spawned background agents have no human to answer — fail clean.
              interactive: !SYSTEM_SPAWNED_AGENT_TYPES.has(ctx.assistantMessage.agent),
            })
            return
          }

          case "tool-result": {
            yield* completeToolCall(value.toolCallId, value.output)
            return
          }

          case "tool-error": {
            const failed = yield* failToolCall(value.toolCallId, value.error)
            if (!failed) {
              yield* createMissingToolCall({
                toolCallID: value.toolCallId,
                toolName: value.toolName,
                toolInput: (value.input as Record<string, any>) ?? {},
                providerExecuted: value.providerExecuted,
                error: value.error,
              })
            }
            const error = errorMessage(value.error)
            const retryCount = yield* session
              .messages({ sessionID: ctx.sessionID, limit: 100, agentID: ctx.assistantMessage.agentID })
              .pipe(
                Effect.map(
                  (messages) =>
                    Math.max(
                      0,
                      sameToolFailureCount({
                        messages,
                        tool: value.toolName,
                        toolInput: value.input,
                        error,
                      }) - 1,
                    ),
                ),
                Effect.catch(() => Effect.succeed(0)),
              )
            if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
              yield* bus
                .publish(Metrics.ToolCall, {
                  sessionID: ctx.sessionID,
                  tool_name: value.toolName,
                  input_bytes: Metrics.jsonByteLength(value.input),
                  output_bytes: 0,
                  tool_call_id: value.toolCallId,
                  tool_call_status: "error",
                  error_category: classifyValidationError(value.error),
                  retry_count: retryCount,
                })
                .pipe(Effect.ignore)
            }
            return
          }

          case "error": {
            // Some provider adapters surface a tool execution/protocol failure
            // as a generic error event while retaining the call identity. Keep
            // that failure as a model-visible tool observation; only a true
            // stream/provider error should terminate the processor and enter
            // the normal retry/error path.
            const toolError = value as {
              toolCallId?: string
              toolName?: string
              input?: unknown
              providerExecuted?: boolean
              error?: unknown
            }
            if (toolError.toolCallId && toolError.toolName && toolError.error !== undefined) {
              const failed = yield* failToolCall(toolError.toolCallId, toolError.error)
              if (!failed) {
                yield* createMissingToolCall({
                  toolCallID: toolError.toolCallId,
                  toolName: toolError.toolName,
                  toolInput: isRecord(toolError.input) ? toolError.input : {},
                  providerExecuted: toolError.providerExecuted,
                  error: toolError.error,
                })
              }
              return
            }
            throw toolError.error ?? new Error("Provider stream error")
          }

          case "start-step":
            if (ctx.stepStartedAt && !ctx.stepFinished) return
            ctx.stepStartedAt = Date.now()
            ctx.stepFirstTokenAt = undefined
            ctx.stepFinished = false
            const stepStartPartId = PartID.ascending()
            yield* session.updatePart(
              ctx.snapshot
                ? {
                    id: stepStartPartId,
                    messageID: ctx.assistantMessage.id,
                    sessionID: ctx.sessionID,
                    snapshot: ctx.snapshot,
                    type: "step-start",
                  }
                : {
                    id: stepStartPartId,
                    messageID: ctx.assistantMessage.id,
                    sessionID: ctx.sessionID,
                    type: "step-start",
                  },
            )
            ctx.stepPartIds.push(stepStartPartId)
            return

          case "finish-step": {
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            const overhead = (value as { overhead?: { cost: number; tokensIn: number; tokensOut: number } }).overhead
            ctx.assistantMessage.finish = value.finishReason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            ctx.responseTokens = addTokens(ctx.responseTokens, usage.tokens)
            syncResponseMetrics()
            yield* writeStepFinish({
              reason: value.finishReason,
              status: "completed",
              usage,
              overhead,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
              yield* goal.addStats({
                sessionID: ctx.sessionID,
                usage: {
                  input: usage.tokens.input,
                  output: usage.tokens.output,
                  reasoning: usage.tokens.reasoning,
                  cache: {
                    read: usage.tokens.cache.read,
                    write: usage.tokens.cache.write,
                  },
                },
              })
            }
            const stepFilesChanged = 0
            const stepTokensIn = usage.tokens.input + usage.tokens.cache.read + usage.tokens.cache.write
            const stepTokensOut = usage.tokens.output + usage.tokens.reasoning
            if (ctx.agentMetrics) {
              ctx.agentMetrics.tokens_in += stepTokensIn
              ctx.agentMetrics.tokens_out += stepTokensOut
              ctx.agentMetrics.files_changed += stepFilesChanged
            }
            if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
              yield* bus
                .publish(Metrics.ModelCall, {
                  sessionID: ctx.sessionID,
                  finish_reason: value.finishReason,
                  ttft_ms:
                    ctx.stepFirstTokenAt && ctx.stepStartedAt ? ctx.stepFirstTokenAt - ctx.stepStartedAt : undefined,
                  submit_to_first_delta_ms:
                    ctx.submitAt && ctx.firstDeltaAt ? ctx.firstDeltaAt - ctx.submitAt : undefined,
                  pre_stream_ms: ctx.submitAt && ctx.streamStartedAt ? ctx.streamStartedAt - ctx.submitAt : undefined,
                  latency_ms: ctx.stepStartedAt ? Date.now() - ctx.stepStartedAt : 0,
                  cached_read_tokens: usage.tokens.cache.read,
                  model_id: ctx.model.id,
                  provider: ctx.model.providerID,
                  total_tokens_in: stepTokensIn,
                  total_tokens_out: stepTokensOut,
                })
                .pipe(Effect.ignore)
            }
            if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
              yield* summary
                .summarize({
                  sessionID: ctx.sessionID,
                  messageID: ctx.assistantMessage.parentID,
                })
                .pipe(Effect.ignore, Effect.forkIn(scope))
            }
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsOverflowHandling = true
            }
            return
          }

          case "text-start":
            yield* beginTextPart(value.providerMetadata)
            return

          case "text-delta":
            if (!ctx.firstDeltaAt) ctx.firstDeltaAt = Date.now()
            if (!ctx.stepFirstTokenAt) ctx.stepFirstTokenAt = Date.now()
            if (!ctx.responseFirstTokenAt) ctx.responseFirstTokenAt = ctx.stepFirstTokenAt
            yield* syncFirstResponseMetrics()
            if (!ctx.currentText) yield* beginTextPart(value.providerMetadata)
            const currentText = ctx.currentText
            if (!currentText) return
            const combined = ctx.pendingText + value.text
            const emitted = combined.slice(0, Math.max(0, combined.length - REDACTION_TAIL_CHARS))
            ctx.pendingText = combined.slice(emitted.length)
            if (!emitted) return
            const safeDelta = redactSensitiveText(emitted)
            currentText.text += safeDelta
            if (value.providerMetadata) currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: currentText.sessionID,
              messageID: currentText.messageID,
              partID: currentText.id,
              field: "text",
              delta: safeDelta,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            const tail = redactSensitiveText(ctx.pendingText)
            ctx.pendingText = ""
            if (tail) {
              ctx.currentText.text += tail
              yield* session.updatePartDelta({
                sessionID: ctx.currentText.sessionID,
                messageID: ctx.currentText.messageID,
                partID: ctx.currentText.id,
                field: "text",
                delta: tail,
              })
            }
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
              ctx.currentText.text = (yield* plugin.trigger(
                "experimental.text.complete",
                {
                  sessionID: ctx.sessionID,
                  messageID: ctx.assistantMessage.id,
                  partID: ctx.currentText.id,
                },
                { text: ctx.currentText.text },
              )).text
            }
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            ctx.pendingText = ""
            return

          case "finish":
            return

          default:
            slog.info("unhandled", { event: value.type, value })
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        ctx.snapshot = undefined

        if (ctx.currentText) {
          ctx.currentText.text += redactSensitiveText(ctx.pendingText)
          ctx.pendingText = ""
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        // Never wait for a tool Deferred during processor cleanup. A provider
        // stream can be interrupted after a tool call is persisted but before
        // its completion event arrives; waiting here makes cancellation depend
        // on an event that can no longer be delivered. The persisted part state
        // below is the source of truth and is finalized as aborted when needed.

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          if (!ctx.stepFinished) {
            yield* writeStepFinish({
              reason: "context-overflow",
              status: "error",
              usage: { cost: 0, tokens: emptyResponseTokens() },
            })
          }
          ctx.needsOverflowHandling = true
          yield* bus.publish(Session.Event.Error, {
            sessionID: ctx.sessionID,
            error,
            visible: !isUserHiddenSystemActorID(ctx.assistantMessage.agentID),
          })
          return
        }
        ctx.assistantMessage.error = error
        if (!ctx.stepFinished) {
          yield* writeStepFinish({
            reason: error.name,
            status: stepStatus(error),
            usage: { cost: 0, tokens: emptyResponseTokens() },
          })
        }
        yield* session.updateMessage(ctx.assistantMessage)
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
          visible: !isUserHiddenSystemActorID(ctx.assistantMessage.agentID),
        })
        if (isMain && manageSessionStatus) {
          yield* status.set(
            ctx.sessionID,
            SessionRetry.retryable(error)
              ? {
                  type: "recoverable",
                  message: "The provider connection failed. The session can be resumed.",
                  reason: error.data && "message" in error.data ? String(error.data.message) : error.name,
                  at: Date.now(),
                }
              : { type: "idle" },
          )
        }
      })

      const ensureTerminalStep = Effect.fn("SessionProcessor.ensureTerminalStep")(function* () {
        if (ctx.stepFinished || ctx.assistantMessage.error) return
        slog.warn("process ended without finish-step", {
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          streamStartedAt: ctx.streamStartedAt,
          firstDeltaAt: ctx.firstDeltaAt,
        })
        ctx.assistantMessage.error = new MessageV2.ModelError({
          message: "The model stream ended before a completion event was received.",
        }).toObject()
        yield* writeStepFinish({
          reason: "missing-finish-step",
          status: "error",
          usage: { cost: 0, tokens: emptyResponseTokens() },
        })
        yield* session.updateMessage(ctx.assistantMessage)
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
          visible: !isUserHiddenSystemActorID(ctx.assistantMessage.agentID),
        })
        if (isMain && manageSessionStatus) yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.requestEnvelopeTokens = streamInput.requestEnvelopeTokens
        ctx.requestEnvelopeMeasuredAt =
          streamInput.requestEnvelopeTokens !== undefined ? ctx.assistantMessage.time.created : undefined
        ctx.needsOverflowHandling = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          const abortController = new AbortController()
          const externalAbortSignal = streamInput.abortSignal
          const abort = () => {
            aborted = true
            abortController.abort()
          }
          const removeExternalAbort = (() => {
            if (!externalAbortSignal) return
            if (externalAbortSignal.aborted) {
              abort()
              return
            }
            externalAbortSignal.addEventListener("abort", abort, { once: true })
            return () => externalAbortSignal.removeEventListener("abort", abort)
          })()
          activeAbortSignal = abortController.signal
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            ctx.stepPartIds = []
            ctx.toolcalls = {}
            const stream = llm.stream({ ...streamInput, abortSignal: abortController.signal })
            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsOverflowHandling),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                abort()
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.tapError(() =>
              Effect.gen(function* () {
                for (const partId of ctx.stepPartIds) {
                  yield* session.removePart({
                    sessionID: ctx.sessionID,
                    messageID: ctx.assistantMessage.id,
                    partID: partId,
                  })
                }
                ctx.stepPartIds = []
              }).pipe(
                // Cleanup is recovery bookkeeping. If the database is already
                // unhealthy, keep the original provider/tool error so the
                // retry policy can still classify it and the model can recover.
                Effect.catchCause((cause) =>
                  Effect.sync(() => slog.warn("failed to remove partial step parts", { cause: String(cause) })),
                ),
              ),
            ),
            Effect.interruptible,
            Effect.retry(
              SessionRetry.policy({
                parse,
                set: (info) =>
                  isMain && manageSessionStatus
                    ? status.set(ctx.sessionID, {
                        type: "retry",
                        attempt: info.attempt,
                        message: info.message,
                        next: info.next,
                      })
                        .pipe(
                          // Status updates are UI/diagnostic side effects. A
                          // stale session row or closed event bus must not
                          // cancel the retry schedule or mask its source error.
                          Effect.catchCauseIf(
                            (cause) => !Cause.hasInterruptsOnly(cause),
                            (cause) =>
                              Effect.sync(() =>
                                slog.warn("retry status update failed; continuing retry", {
                                  attempt: info.attempt,
                                  error: String(cause),
                                }),
                              ),
                          ),
                        )
                    : Effect.void,
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(
              cleanup().pipe(
                Effect.catchCause((cause) =>
                  Effect.sync(() => slog.error("cleanup failed", { cause: Cause.squash(cause) })),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    removeExternalAbort?.()
                    if (activeAbortSignal === abortController.signal) activeAbortSignal = undefined
                  }),
                ),
              ),
            ),
          )

          if (abortController.signal.aborted) {
            if (!ctx.assistantMessage.error) {
              yield* halt(new DOMException("Aborted", "AbortError"))
            }
            return "stop"
          }
          yield* ensureTerminalStep()
          yield* syncInteractiveWaiting()
          if (ctx.needsOverflowHandling) return "overflow"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      const replay = Effect.fn("SessionProcessor.replay")(function* (input: ReplayInput) {
        slog.info("replay", { toolCalls: input.toolCalls.length, finish: input.finishReason })
        ctx.requestEnvelopeTokens = input.requestEnvelopeTokens
        ctx.requestEnvelopeMeasuredAt =
          input.requestEnvelopeTokens !== undefined ? ctx.assistantMessage.time.created : undefined
        ctx.needsOverflowHandling = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        const ctrl = new AbortController()
        const externalAbortSignal = input.abortSignal
        const abort = () => {
          aborted = true
          ctrl.abort()
        }
        const removeExternalAbort = (() => {
          if (!externalAbortSignal) return
          if (externalAbortSignal.aborted) {
            abort()
            return
          }
          externalAbortSignal.addEventListener("abort", abort, { once: true })
          return () => externalAbortSignal.removeEventListener("abort", abort)
        })()

        const emptyUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}

            // Mirror a real model call: start → start-step → reasoning → text →
            // (tool-input-start → tool-call → execute → tool-result)* → finish-step
            yield* handleEvent({ type: "start" } as StreamEvent)
            yield* handleEvent({
              type: "start-step",
              request: {},
              warnings: [],
            } as unknown as StreamEvent)

            const selectionNote = input.selection
              ? `[max mode] selected candidate ${input.selection.winner + 1} of ${input.selection.total}`
              : undefined
            const reasoningText = [selectionNote, input.reasoning].filter(Boolean).join("\n\n")

            if (reasoningText) {
              const rid = "reasoning-replay"
              const backdatedStart = input.thinkingMs ? Date.now() - input.thinkingMs : undefined
              yield* handleEvent({
                type: "reasoning-start",
                id: rid,
                providerMetadata: input.reasoningMetadata,
                ...(backdatedStart ? { time: { start: backdatedStart } } : {}),
              } as unknown as StreamEvent)
              yield* handleEvent({
                type: "reasoning-delta",
                id: rid,
                text: reasoningText,
                providerMetadata: input.reasoningMetadata,
              } as unknown as StreamEvent)
              yield* handleEvent({
                type: "reasoning-end",
                id: rid,
                providerMetadata: input.reasoningMetadata,
              } as unknown as StreamEvent)
            }

            if (input.text) {
              const tid = "text-replay"
              yield* handleEvent({
                type: "text-start",
                id: tid,
                providerMetadata: input.textMetadata,
              } as unknown as StreamEvent)
              yield* handleEvent({
                type: "text-delta",
                id: tid,
                text: input.text,
                providerMetadata: input.textMetadata,
              } as unknown as StreamEvent)
              yield* handleEvent({
                type: "text-end",
                id: tid,
                providerMetadata: input.textMetadata,
              } as unknown as StreamEvent)
            }

            for (const call of input.toolCalls) {
              if (ctx.needsOverflowHandling) break
              yield* handleEvent({
                type: "tool-input-start",
                id: call.toolCallId,
                toolName: call.toolName,
                providerMetadata: call.providerMetadata,
              } as unknown as StreamEvent)
              yield* handleEvent({
                type: "tool-call",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                input: call.input,
                providerMetadata: call.providerMetadata,
              } as unknown as StreamEvent)

              const t = input.tools[call.toolName]
              if (!t || !t.execute) {
                yield* handleEvent({
                  type: "tool-error",
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  input: call.input,
                  error: new Error(`Tool "${call.toolName}" has no executor`),
                } as unknown as StreamEvent)
                continue
              }

              const outcome = yield* Effect.tryPromise({
                try: () =>
                  t.execute!(call.input, {
                    toolCallId: call.toolCallId,
                    messages: input.messages,
                    abortSignal: ctrl.signal,
                  }),
                catch: (e) => e,
              }).pipe(
                Effect.map((output) => ({ ok: true as const, output })),
                Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
              )

              if (!outcome.ok) {
                yield* handleEvent({
                  type: "tool-error",
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  input: call.input,
                  error: outcome.error,
                } as unknown as StreamEvent)
              } else {
                // The execute closure resolves with { title, metadata, output, attachments }.
                // Feeding it through the tool-result handler completes the part
                // (unless execute already completed it on abort — completeToolCall
                // is a no-op once the part is no longer "running").
                yield* handleEvent({
                  type: "tool-result",
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  input: call.input,
                  output: outcome.output,
                } as unknown as StreamEvent)
              }
            }

            yield* handleEvent({
              type: "finish-step",
              usage: input.usage ?? emptyUsage,
              finishReason: input.finishReason,
              providerMetadata: input.providerMetadata,
              ...(input.overhead ? { overhead: input.overhead } : {}),
            } as unknown as StreamEvent)

            // Account for ensemble overhead (losing candidates + judge): real
            // spend that consumed no context. Add it to cost + agent metrics +
            // a supplementary ModelCall metric, but NOT to message.tokens (set
            // by the finish-step above from the winner only) so context
            // estimators stay honest.
            if (input.overhead && (input.overhead.cost > 0 || input.overhead.tokensIn > 0 || input.overhead.tokensOut > 0)) {
              ctx.assistantMessage.cost += input.overhead.cost
              yield* session.updateMessage(ctx.assistantMessage)
              if (ctx.agentMetrics) {
                ctx.agentMetrics.tokens_in += input.overhead.tokensIn
                ctx.agentMetrics.tokens_out += input.overhead.tokensOut
              }
              if (!isUserHiddenSystemActorID(ctx.assistantMessage.agentID)) {
                yield* bus
                  .publish(Metrics.ModelCall, {
                    sessionID: ctx.sessionID,
                    finish_reason: "max-mode-overhead",
                    latency_ms: 0,
                    cached_read_tokens: 0,
                    model_id: ctx.model.id,
                    provider: ctx.model.providerID,
                    total_tokens_in: input.overhead.tokensIn,
                    total_tokens_out: input.overhead.tokensOut,
                  })
                  .pipe(Effect.ignore)
              }
          }
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                // Propagate cancellation into the currently-executing tool so a
                // long-running winner tool call is actually interrupted.
                ctrl.abort()
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.catch(halt),
            Effect.ensuring(
              cleanup().pipe(
                Effect.catchCause((cause) =>
                  Effect.sync(() => slog.error("cleanup failed", { cause: Cause.squash(cause) })),
                ),
                Effect.ensuring(Effect.sync(() => removeExternalAbort?.())),
              ),
            ),
          )

          if (ctrl.signal.aborted) {
            if (!ctx.assistantMessage.error) {
              yield* halt(new DOMException("Aborted", "AbortError"))
            }
            return "stop"
          }
          yield* syncInteractiveWaiting()
          if (ctx.needsOverflowHandling) return "overflow"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
        replay,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Goal.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"
