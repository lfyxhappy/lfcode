import path from "path"
import os from "os"
import z from "zod"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { insertTavernContext } from "./tavern-context"
import { classifyAssistantStep } from "./classify"
import { Log } from "../util"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { SYSTEM_SPAWNED_AGENT_TYPES } from "@/agent/config"
import { Provider } from "../provider"
import * as ProviderTransform from "../provider/transform"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, type ModelMessage, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionPrune } from "./prune"
import { SessionCheckpoint } from "./checkpoint"
import { SessionCompaction } from "./compaction"
import { estimateRequestTokens, isOverflow as overflowCheck, shouldAutoCompact, usable } from "./overflow"
import { Config } from "@/config"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Bus } from "../bus"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Plugin } from "../plugin"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { Skill } from "@/skill"
import { ToolRegistry } from "../tool"
import { transformedToolSchema } from "../tool/registry"
import { nativeWebSearchTool } from "../tool/websearch/native"
import { MCP } from "../mcp"
import { shouldUseCodegraph } from "../mcp/codegraph-task"
import { LSP } from "../lsp"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { ConfigMarkdown } from "../config"
import { SessionSummary } from "./summary"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { SessionProcessor } from "./processor"
import { buildLLMRequestPrefix, buildSkillCatalogEntries } from "./llm-request-prefix"
import { prefixCaptureRef } from "./prefix-capture-ref"
import { spawnRef } from "@/actor/spawn-ref"
import type { SpawnResult } from "@/actor/spawn"
import { Inbox } from "@/inbox"
import { sessionPromptRef } from "@/inbox/inbox-ref"
import { Tool } from "@/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { MaxMode } from "./max-mode"
import { Shell } from "@/shell/shell"
import { AppFileSystem } from "@/filesystem"
import { Truncate } from "@/tool"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util"
import { Cause, Deferred, Effect, Exit, Layer, Option, Scope, Context } from "effect"
import { EffectLogger } from "@/effect"
import { InstanceState } from "@/effect"
import { ActorTool, type ActorPromptOps } from "@/tool/actor"
import { SessionRunState } from "./run-state"
import { Goal } from "./goal"
import { isRealUserPart, repeatedToolValidationFailure, stepSignature } from "./part-helpers"
import { EffectBridge } from "@/effect"
import { Team } from "@/team"
import { ActorRegistry } from "@/actor/registry"
import { Metrics } from "@/metrics"
import { isExplicitMemoryRequest } from "@/memory/intent"
import { ContextReview, ContextReviewFindingsOutput, type Record as ContextReviewRecord } from "@/context-review"
import { dispatchHooks } from "@/hook/runtime"
import { Snapshot as ResearchDispatchSnapshot } from "@/research/dispatch"
import { isUserHiddenSystemActorID } from "@/actor/visibility"
import { nativeToolsForPresentation, resolvePresentation } from "@/tool/code-mode"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

/**
 * Cap on goal-driven main-loop re-entries per turn — the safety valve against
 * a never-satisfiable condition burning tokens forever. Higher than spawned
 * actors' MAX_PRE_REACT (=3) because main-session goals are usually larger.
 * TODO: lift to lfcode.json config (e.g. session.maxGoalReact).
 */
const MAX_GOAL_REACT = 12

/**
 * Number of consecutive finished assistant steps with an identical action
 * signature that trips the repeated-step nudge. Three in a row is a strong
 * signal the model is stuck repeating itself rather than making progress.
 */
const REPEATED_STEP_THRESHOLD = 3
const REPEATED_TOOL_VALIDATION_FAILURE_THRESHOLD = 3

/**
 * Stable signature for an assistant step's *action* — the tool calls it made
 * (name + key-order-independent input). Text and reasoning are excluded on
 * purpose: in a ReAct loop the model narrates each step in slightly different
 * words while taking the exact same action, and some models emit their
 * reasoning as plain text parts — counting either would mask the repeated
 * action we want to catch. Returns undefined when a step makes no tool calls
 * (e.g. a pure-text turn), since there is no repeated *action* to compare.
 */
const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export function codegraphFallbackReminder(reason?: string) {
  const detail = reason?.replace(/\s+/g, " ").trim().slice(0, 240)
  return [
    "<system-reminder>",
    "CodeGraph is unavailable for this request, so codegraph_explore is intentionally hidden.",
    detail ? `Reason: ${detail}` : undefined,
    "Do not retry codegraph_explore. Continue with Read, Grep, Glob, and the other available tools.",
    "</system-reminder>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

const PREDICT_SYSTEM = `You predict the single most likely next message a user will send to a coding assistant, based on the conversation so far. Output only that next message as one short, natural first-person request (what the user would type). No preamble, no quotes, no explanation, no markdown. Keep it under 100 characters.`

const PREDICT_NUDGE = `Based on the conversation above, write the user's most likely next message:`

const OUTPUT_LENGTH_CONTINUATION_LIMIT = Flag.LFCODE_OUTPUT_LENGTH_CONTINUATION_LIMIT
const INVALID_OUTPUT_CONTINUATION_LIMIT = Flag.LFCODE_INVALID_OUTPUT_CONTINUATION_LIMIT
const INTERRUPTED_OUTPUT_CONTINUATION_LIMIT = INVALID_OUTPUT_CONTINUATION_LIMIT
const STEER_MARKER = "lfcode:followup-steer"

function formatContextReview(review: ContextReviewRecord) {
  const findings = review.findings
  if (!findings || (findings.skills.length === 0 && findings.memory.length === 0)) return
  return [
    `<context_review source_user_message_id="${escapeContextReview(String(review.sourceUserMessageID))}">`,
    "A hidden reviewer found context that may have been omitted in the immediately preceding turn. This advice is only relevant if the current user request continues that topic.",
    "If it remains relevant, you MUST load every listed Skill with the skill tool and/or search the listed Memory query with the memory tool before a substantive answer. If the current request is unrelated, ignore this review and do not load it.",
    ...findings.skills.map((item) => `<skill name="${escapeContextReview(item.name)}" />`),
    ...findings.memory.map((item) => `<memory query="${escapeContextReview(item.query)}" />`),
    "</context_review>",
  ].join("\n")
}

function escapeContextReview(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;"
    if (char === "<") return "&lt;"
    if (char === ">") return "&gt;"
    if (char === '"') return "&quot;"
    return "&apos;"
  })
}

/**
 * Context review is strictly for a real user turn handled by the primary
 * runner. Synthetic continuations and internal spawn, hook, or automation
 * requests must never create advice for a later user request.
 */
function isReviewableMainUser(message: MessageV2.WithParts) {
  if (message.info.role !== "user") return false
  if (message.info.source && message.info.source !== "user") return false
  return message.parts.some(isRealUserPart)
}

function loadedSkillNames(messages: MessageV2.WithParts[]) {
  const loaded = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool" && part.tool === "skill" && part.state.status === "completed") {
        const name = part.state.metadata?.name
        if (typeof name === "string") loaded.add(name)
      }
    }
  }
  return [...loaded].toSorted()
}

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })
type SweepOrphanAssistantsOptions = {
  minAgeMs?: number
  message?: string
}

/**
 * Per-execution controls used by trusted runtime callers. These deliberately
 * stay out of PromptInput so an HTTP prompt request cannot change the durable
 * session permission ruleset or grant itself elevated access.
 */
type PromptRunOptions = {
  abortSignal?: AbortSignal
  permission?: Permission.Ruleset
  interactive?: boolean
  onPermissionRequest?: () => void
  onQuestionRequest?: () => void
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (
    input: PromptInput,
    options?: PromptRunOptions,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: z.infer<typeof LoopInput>) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  readonly sweepOrphanAssistants: (sessionID: SessionID, options?: SweepOrphanAssistantsOptions) => Effect.Effect<void>
  readonly predict: (input: { sessionID: SessionID }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const prune = yield* SessionPrune.Service
    const checkpoint = yield* SessionCheckpoint.Service
    const compaction = yield* SessionCompaction.Service
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const goal = yield* Goal.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const actorRegistry = yield* ActorRegistry.Service
    const inbox = yield* Inbox.Service
    const skill = yield* Skill.Service
    const contextReview = yield* ContextReview.Service

    // Track sessions that have already shown the "loaded instructions" toast so we
    // surface it once per primary session rather than on every run-loop turn.
    const instructionsNotified = new Set<SessionID>()
    const hookStarted = new Set<SessionID>()
    const codegraphFallbackNotified = new Set<SessionID>()
    const codegraphUnavailableRequests = new Set<MessageID>()
    const steerWakeups = new Set<SessionID>()

    // Late-bind prefix-capture helper so SessionCheckpoint.tryStartCheckpointWriter
    // can call buildLLMRequestPrefix without forming a layer cycle
    // (ToolRegistry → SessionCheckpoint → ToolRegistry). See prefix-capture-ref.ts.
    // The closure resolves Agent.Info and Provider.Model internally so checkpoint.ts
    // only needs to pass string IDs.
    const capture: typeof prefixCaptureRef.current = (input) =>
      Effect.gen(function* () {
        const empty = {
          system: [] as string[],
          tools: {} as Record<string, AITool>,
          inheritedMessages: [] as ModelMessage[],
          parentPermission: [] as Permission.Ruleset,
        }
        const ag = yield* agents.get(input.agentName).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!ag) return empty
        const model = yield* provider
          .getModel(input.providerID as ProviderID, input.modelID as ModelID)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!model) return empty
        const session = yield* sessions.get(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const tavern = session ? isTavernSession(session) : false
        const effectivePermission = input.permission ?? Permission.merge(ag.permission, session?.permission ?? [])
        if (tavern) {
          const prefix = yield* buildLLMRequestPrefix({
            sessionID: input.sessionID,
            agent: ag,
            model,
            msgs: input.msgs as Parameters<typeof buildLLMRequestPrefix>[0]["msgs"],
            additions: [],
            permission: effectivePermission,
            actorID: input.actorID,
            includeSkills: false,
            includeTools: false,
          }).pipe(
            Effect.provideService(LLM.Service, llm),
            Effect.provideService(ToolRegistry.Service, registry),
            Effect.provideService(Skill.Service, skill),
            Effect.catch(() => Effect.succeed(empty)),
          )
          return { ...prefix, parentPermission: effectivePermission }
        }
        const [skills, env, instructions] = yield* Effect.all([
          sys.skills(ag),
          Effect.sync(() => sys.environment(model)),
          instruction.system().pipe(Effect.orDie),
        ])
        // (checkpoint-writer never requests json_schema output, so STRUCTURED_OUTPUT_SYSTEM_PROMPT
        // is not included; parent's runLoop adds it conditionally based on user.format)
        const additions = [...env, ...(skills ? [skills] : []), ...instructions.content]
        const prefix = yield* buildLLMRequestPrefix({
          sessionID: input.sessionID,
          agent: ag,
          model,
          msgs: input.msgs as Parameters<typeof buildLLMRequestPrefix>[0]["msgs"],
          permission: effectivePermission,
          actorID: input.actorID,
          additions,
        }).pipe(
          Effect.provideService(LLM.Service, llm),
          Effect.provideService(ToolRegistry.Service, registry),
          Effect.provideService(Skill.Service, skill),
          Effect.catch(() => Effect.succeed(empty)),
        )
        return { ...prefix, parentPermission: effectivePermission }
      })
    prefixCaptureRef.current = capture
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (prefixCaptureRef.current === capture) prefixCaptureRef.current = undefined
      }),
    )

    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const scheduleContextReview = Effect.fn("SessionPrompt.scheduleContextReview")(function* (input: {
      sessionID: SessionID
      user: MessageV2.User
      assistant: MessageV2.Assistant
      agent: Agent.Info
      model: Provider.Model
      permission?: Permission.Ruleset
      /** Frozen primary-session slice through sourceAssistantMessageID. */
      messages: MessageV2.WithParts[]
    }) {
      if (!((yield* config.getGlobal()).context_review?.enabled ?? true)) return
      const record = yield* contextReview.create({
        sessionID: input.sessionID,
        sourceUserMessageID: input.user.id,
        sourceAssistantMessageID: input.assistant.id,
      })
      if (record.status !== "pending") return
      // Config can change while the main response is finishing. Re-check after
      // durable admission so a just-disabled reviewer cannot begin work.
      if (!((yield* config.getGlobal()).context_review?.enabled ?? true)) {
        yield* contextReview.expire({ sessionID: input.sessionID })
        return
      }
      const spawn = spawnRef.current
      if (!spawn) {
        yield* contextReview.fail({ id: record.id, error: "Context reviewer spawn service is unavailable" })
        return
      }
      // Everything after durable admission can fail while preparing the reviewer
      // snapshot. A detached scheduling fiber must never strand a pending record.
      const result: SpawnResult | undefined = yield* Effect.gen(function* () {
        const catalogSkills = (yield* skill.available(input.agent, input.permission)).toSorted((a, b) =>
          a.name.localeCompare(b.name),
        )
        const catalog = buildSkillCatalogEntries(catalogSkills, input.model)
        const loadedSkills = loadedSkillNames(input.messages)
        const prefix = yield* capture({
          sessionID: input.sessionID,
          agentName: "context-reviewer",
          providerID: String(input.model.providerID),
          modelID: String(input.model.id),
          permission: input.permission,
          actorID: "context-reviewer",
          msgs: input.messages,
        })
        // Spawn is asynchronous and may fail after the durable review record is
        // admitted (for example, while registering its in-memory fork context).
        // Never leave that record pending until another user turn happens to
        // expire it; failed work must become terminal immediately.
        return yield* spawn.spawn({
          mode: "subagent",
          sessionID: input.sessionID,
          agentType: "context-reviewer",
          task: [
            "Audit the completed main-agent turn now. The full primary conversation is inherited. Compare the completed turn with this exact current Skill catalog; identify only workflows that were materially relevant but omitted.",
            "If continuity or durable user/project context was materially omitted, use the read-only memory tool with one or two distinctive search terms and return only the narrow follow-up query, never retrieved content.",
            "Return the required structured result with empty arrays when nothing was omitted.",
            loadedSkills.length > 0
              ? `Do not recommend any already loaded Skill: ${loadedSkills.map((name) => JSON.stringify(name)).join(", ")}.`
              : undefined,
            "<available_skill_catalog>",
            catalog,
            "</available_skill_catalog>",
          ].filter((item): item is string => Boolean(item)).join("\n"),
          description: "Internal context omission review",
          context: "full",
          tools: ["memory"],
          model: { providerID: input.model.providerID, modelID: input.model.id },
          background: true,
          immediate: true,
          // Full-context reviewer work carries an in-memory fork snapshot and
          // structured-output closure, so only this internal actor bypasses
          // durable dispatch serialization.
          bypassDispatch: true,
          lifecycle: "ephemeral",
          forkContext: {
            ...prefix,
            watermarkMsgID: input.assistant.id,
            model: { providerID: input.model.providerID, modelID: input.model.id },
          },
          format: { type: "json_schema", schema: z.toJSONSchema(ContextReviewFindingsOutput), retryCount: 1 },
        })
      }).pipe(
        Effect.catchCause(() =>
          contextReview
            .fail({ id: record.id, error: "Context reviewer could not be prepared or started" })
            .pipe(Effect.as(undefined as SpawnResult | undefined)),
        ),
      )
      if (!result) return
      const started = yield* contextReview.start({ id: record.id, reviewerActorID: result.actorID })
      // `expire()` may have won the race while spawn was registering. Do not
      // let an obsolete reviewer consume model capacity after that transition.
      if (!started) {
        // A superseding user turn may already have admitted its own review.
        // Only revoke this obsolete record; expiring the whole session here
        // would silently discard that newer hand-off.
        yield* contextReview.expireRecord({ id: record.id })
        yield* spawn.cancel(input.sessionID, result.actorID, "forced").pipe(Effect.ignore)
        return
      }
      if (!((yield* config.getGlobal()).context_review?.enabled ?? true)) {
        yield* contextReview.expire({ sessionID: input.sessionID })
        yield* spawn.cancel(input.sessionID, result.actorID, "forced").pipe(Effect.ignore)
        return
      }
      yield* Deferred.await(result.outcome)
        .pipe(
          Effect.flatMap((outcome) => {
            if (outcome.status === "success" && outcome.structured !== undefined)
              return contextReview.complete({ id: record.id, findings: outcome.structured })
            return contextReview.fail({
              id: record.id,
              error: outcome.status === "failure" ? outcome.error : "Context reviewer returned no structured result",
            })
          }),
          Effect.asVoid,
          Effect.forkIn(scope),
        )
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      const run = yield* runner()
      return {
        cancel: (sessionID: SessionID) => run.fork(cancel(sessionID)),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input),
      } satisfies ActorPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* state.cancel(sessionID)
      yield* Effect.promise(() =>
        dispatchHooks({
          event: "Stop",
          sessionID,
          projectID: String(Instance.project.id),
          cwd: Instance.worktree,
          payload: { reason: "cancelled" },
        }),
      ).pipe(
        Effect.timeout("2 seconds"),
        Effect.catchCause((cause) => elog.warn("stop-hook-failed", { sessionID, cause: String(cause) })),
        Effect.forkIn(scope),
      )
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: PromptInput["parts"] = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (seen.has(name)) return
          seen.add(name)
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: MessageV2.WithParts[]
      providerID: ProviderID
      modelID: ModelID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.modelRef
        ? yield* provider.resolveModelRef(ag.modelRef, input.providerID)
        : ag.model
          ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
          : ((yield* provider.getSmallModel(input.providerID)) ??
            (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const predict = Effect.fn("SessionPrompt.predict")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (cfg.experimental?.predict_next_prompt === false) return ""

      const history = yield* sessions.messages({ sessionID: input.sessionID, agentID: "main" })
      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const userIdx = history.findLastIndex(real)
      if (userIdx === -1) return ""
      const lastUser = history[userIdx]
      if (lastUser.info.role !== "user") return ""

      // Only the assistant turn that actually answered this user message counts.
      // Bail if that turn is still running (an incomplete assistant after it),
      // so we never pair the newest prompt with a stale/older result.
      const assistants = history
        .slice(userIdx + 1)
        .filter((m): m is MessageV2.WithParts & { info: MessageV2.Assistant } => m.info.role === "assistant")
      if (assistants.length === 0) return ""
      if (assistants.some((m) => m.info.time.completed === undefined)) return ""
      const lastAssistant = assistants[assistants.length - 1]

      const base = yield* agents.get("title")
      if (!base) return ""
      // Reuse the lightweight title agent's settings but swap its prompt for the
      // prediction prompt — its default ("output ONLY a thread title") would
      // otherwise be prepended ahead of PREDICT_SYSTEM and win.
      const ag = { ...base, prompt: PREDICT_SYSTEM }
      const mdl = ag.modelRef
        ? yield* provider.resolveModelRef(ag.modelRef, lastAssistant.info.providerID)
        : ag.model
          ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
          : ((yield* provider.getSmallModel(lastAssistant.info.providerID)) ??
            (yield* provider.getModel(lastAssistant.info.providerID, lastAssistant.info.modelID)))

      const msgs = yield* MessageV2.toModelMessagesEffect([lastUser, lastAssistant], mdl, { stripMedia: true })
      const text = yield* llm
        .stream({
          agent: ag,
          user: lastUser.info,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.sessionID,
          retries: 1,
          messages: [...msgs, { role: "user", content: PREDICT_NUDGE }],
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orElseSucceed(() => ""),
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return ""
      const stripped = cleaned.replace(quoteTrimRegex, "")
      return stripped.length > 120 ? stripped.substring(0, 117) + "..." : stripped
    })

    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
      messages: MessageV2.WithParts[]
      agent: Agent.Info
      session: Session.Info
    }) {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
      if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
        const plan = Session.plan(input.session)
        if (!(yield* fsys.existsSafe(plan))) return input.messages
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
        return input.messages
      }

      if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

      const plan = Session.plan(input.session)
      const exists = yield* fsys.existsSafe(plan)
      if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
      const part = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. Read it and make incremental changes with the edit tool.` : `No plan file exists yet. Create it at ${plan} with edit operation=write.`}
You should build your plan incrementally using patch-first file tools on this file only. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
 - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
 - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
 - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
 - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })

    const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      session: Session.Info
      tools?: Record<string, boolean>
      processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
      bypassAgentCheck: boolean
      nativeWebSearchBlocked: boolean
      messages: MessageV2.WithParts[]
      contextReviewMemory?: boolean
      agentID?: string
      task_id?: string
      permission?: Permission.Ruleset
      interactive?: boolean
      onPermissionRequest?: () => void
      onQuestionRequest?: () => void
    }) {
      using _ = log.time("resolveTools")
      const tools: Record<string, AITool> = {}
      if (isTavernSession(input.session)) return tools
      const run = yield* runner()
      const promptOps = yield* ops()

      // Per-tool runtime whitelist: when the LLM call is being made on behalf
      // of a registered actor (subagent or peer), look up the actor row and,
      // if `actor.tools` is an array, reject calls to tools not in the
      // whitelist. `INHERIT` and a missing actor row both mean full access.
      const whitelistFor = Effect.fn("SessionPrompt.whitelistFor")(function* () {
        if (!input.agentID) return undefined
        const actor = yield* actorRegistry.get(input.session.id, input.agentID)
        if (!actor || !Array.isArray(actor.tools)) return undefined
        return new Set(actor.tools)
      })
      const whitelist = yield* whitelistFor()
      // Match LLM.resolveTools exactly: agent defaults are overridden by the
      // session and then by this run's temporary rules. The same ruleset must
      // drive catalog discovery, tool visibility, and exact Skill loading.
      const effectivePermission = Permission.merge(
        input.agent.permission,
        input.session.permission ?? [],
        input.permission ?? [],
      )
      const memoryEnabled =
        input.agent.name === "dream" ||
        input.agent.name === "context-reviewer" ||
        input.contextReviewMemory === true ||
        isExplicitMemoryRequest(input.messages)
      const userExtensionsEnabled = input.agent.name !== "context-reviewer"
      const rejectionFor = (toolID: string) => ({
        title: "Tool not permitted",
        output: `The "${toolID}" tool is not in this actor's whitelist. Allowed tools: ${
          whitelist ? [...whitelist].join(", ") : "(none)"
        }.`,
        metadata: { rejected: true, reason: "tool-whitelist" as const },
      })

      const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: {
          model: input.model,
          bypassAgentCheck: input.bypassAgentCheck,
          contextReviewMemory: input.contextReviewMemory === true,
          skillPermission: effectivePermission,
          promptOps,
          onQuestionRequest: input.onQuestionRequest,
        },
        agent: input.agent.name,
        actorID: input.agentID,
        taskId: input.task_id,
        messages: input.messages,
        metadata: (val) =>
          input.processor.updateToolCall(options.toolCallId, (match) => {
            if (!["running", "pending"].includes(match.state.status)) return match
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: "running",
                input: args,
                time: { start: Date.now() },
              },
            }
          }),
        ask: (req) =>
          Effect.gen(function* () {
            const hook = yield* Effect.promise(() =>
              dispatchHooks({
                event: "PermissionRequest",
                sessionID: input.session.id,
                projectID: String(input.session.projectID),
                cwd: input.session.directory,
                tool: req.permission,
                payload: { patterns: req.patterns, metadata: req.metadata },
                promptEvaluator: (request) => evaluateHookPrompt(request),
              }),
            )
            if (hook.blocked) throw new Error("Permission request was blocked by a Hook")
            const ruleset = effectivePermission
            if (
              input.onPermissionRequest &&
              req.patterns.some((pattern) => Permission.evaluate(req.permission, pattern, ruleset).action === "ask")
            ) {
              yield* Effect.sync(input.onPermissionRequest)
            }
            return yield* permission
              .ask(
                {
                  ...req,
                  sessionID: input.session.id,
                  tool: { messageID: input.processor.message.id, callID: options.toolCallId },
                  // A subagent has its own capability policy. Put it after the
                  // parent session rules so an old session-wide tool deny cannot
                  // disable the read/search tools that the selected subagent is
                  // explicitly configured to use. Main-agent calls retain the
                  // session override semantics.
                  ruleset,
                  // System-spawned background agents (checkpoint-writer, dream, distill)
                  // have no human to answer a permission prompt — fail clean, don't hang.
                  interactive: input.interactive ?? !SYSTEM_SPAWNED_AGENT_TYPES.has(input.agent.name),
                },
                options.abortSignal,
              )
              .pipe(Effect.orDie)
          }),
      })

      const hookUser = input.messages.findLast(
        (message): message is MessageV2.WithParts & { info: MessageV2.User } => message.info.role === "user",
      )?.info
      const evaluateHookPrompt = (request: { prompt: string; event: Record<string, unknown>; timeoutMs: number }) => {
        const user = hookUser
        if (!user) return Promise.reject(new Error("Hook prompt has no user context"))
        return Effect.runPromise(
          llm
            .stream({
              user,
              sessionID: input.session.id,
              model: input.model,
              agent: input.agent,
              agentID: input.agentID,
              prebuiltSystem: [
                'You are a Hook decision evaluator. Return JSON only: {"decision":"allow"|"block"|"ask","reason":string,"additional_context":string}. Do not call tools. ask is valid only for PermissionRequest.',
              ],
              system: [],
              messages: [{ role: "user", content: `${request.prompt}\n\nEvent:\n${JSON.stringify(request.event)}` }],
              tools: {},
              toolChoice: "none",
              retries: 0,
            })
            .pipe(
              Stream.filter(
                (event): event is Extract<LLM.Event, { type: "text-delta" }> => event.type === "text-delta",
              ),
              Stream.map((event) => event.text),
              Stream.mkString,
              Effect.map((text) => {
                const parsed = JSON.parse(text) as {
                  decision?: "allow" | "block" | "ask"
                  reason?: string
                  additional_context?: string
                }
                if (!parsed.decision || !["allow", "block", "ask"].includes(parsed.decision))
                  throw new Error("Invalid Hook prompt response")
                return {
                  decision: parsed.decision,
                  reason: parsed.reason,
                  additionalContext: parsed.additional_context,
                }
              }),
              Effect.timeout(`${request.timeoutMs} millis`),
              Effect.flatMap((result) =>
                result ? Effect.succeed(result) : Effect.fail(new Error("Hook prompt timed out")),
              ),
            ),
        )
      }

      const visibleTools = (yield* registry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
        capabilities: input.model.capabilities,
        activeSkills: Skill.activeNames(input.messages),
      })).filter((item) => {
        if (item.id === ActorTool.id && input.agent.mode !== "primary" && input.agent.name !== "deep-research-coordinator") return false
        if (item.id === "memory" && !memoryEnabled) return false
        return true
      })
      const presentation = resolvePresentation({
        // The context reviewer has a fixed read-only probe contract and must keep
        // its native memory tool available for that internal protocol.
        configured: input.agent.name === "context-reviewer" ? "native" : (yield* config.get()).tool?.presentation,
        tools: visibleTools,
      })
      const nativeTools = nativeToolsForPresentation(presentation, visibleTools)

      for (const item of nativeTools) {
        const schemaBuildStartedAt = Date.now()
        const schema = transformedToolSchema(input.model, item.parameters)
        const schemaBuildMs = Date.now() - schemaBuildStartedAt
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args, options) {
            return run.promise(
              Effect.gen(function* () {
                const startTs = Date.now()
                const callID = options?.toolCallId ?? "?"
                log.debug("tool execute start", {
                  tool: item.id,
                  callID,
                  sessionID: input.session.id,
                })
                const ctx = context(args, options)
                if (whitelist && !whitelist.has(item.id)) {
                  const output = rejectionFor(item.id)
                  log.debug("tool execute rejected", {
                    tool: item.id,
                    callID,
                    durationMs: Date.now() - startTs,
                  })
                  yield* input.processor.completeToolCall(options.toolCallId, output)
                  return output
                }
                if (userExtensionsEnabled) {
                  const beforeHook = yield* Effect.promise(() =>
                    dispatchHooks({
                      event: "PreToolUse",
                      sessionID: ctx.sessionID,
                      projectID: String(input.session.projectID),
                      cwd: input.session.directory,
                      tool: item.id,
                      payload: { args, callID },
                      promptEvaluator: (request) => evaluateHookPrompt(request),
                    }),
                  )
                  if (beforeHook.blocked) {
                    const output = {
                      title: "Hook blocked tool",
                      output: "Tool execution was blocked by a user Hook",
                      metadata: {},
                    }
                    yield* input.processor.completeToolCall(options.toolCallId, output)
                    return output
                  }
                }
                if (userExtensionsEnabled) {
                  yield* plugin.trigger(
                    "tool.execute.before",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                    { args },
                  )
                }
                const execute = item.execute(args, ctx)
                const result = yield* (userExtensionsEnabled
                  ? execute.pipe(
                      Effect.tapError(() =>
                        Effect.promise(() =>
                          dispatchHooks({
                            event: "PostToolUseFailure",
                            sessionID: ctx.sessionID,
                            projectID: String(input.session.projectID),
                            cwd: input.session.directory,
                            tool: item.id,
                            payload: { args, callID },
                            promptEvaluator: (request) => evaluateHookPrompt(request),
                          }),
                        ),
                      ),
                    )
                  : execute)
                log.debug("tool execute done", {
                  tool: item.id,
                  callID,
                  durationMs: Date.now() - startTs,
                  ok: true,
                })
                const output = {
                  ...result,
                  attachments: result.attachments?.map((attachment) => ({
                    ...attachment,
                    id: PartID.ascending(),
                    sessionID: ctx.sessionID,
                    messageID: input.processor.message.id,
                  })),
                }
                if (userExtensionsEnabled) {
                  yield* plugin.trigger(
                    "tool.execute.after",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                    output,
                  )
                  yield* Effect.promise(() =>
                    dispatchHooks({
                      event: "PostToolUse",
                      sessionID: ctx.sessionID,
                      projectID: String(input.session.projectID),
                      cwd: input.session.directory,
                      tool: item.id,
                      payload: { args, output: output.output },
                      promptEvaluator: (request) => evaluateHookPrompt(request),
                    }),
                  )
                }
                if (userExtensionsEnabled) {
                  yield* bus
                    .publish(Metrics.ToolCall, {
                      sessionID: ctx.sessionID,
                      tool_name: item.id,
                      input_bytes: Metrics.jsonByteLength(args),
                      output_bytes: Buffer.byteLength(output.output ?? "", "utf8"),
                      tool_call_id: options.toolCallId,
                      tool_call_status: "success",
                      execute_ms: Date.now() - startTs,
                      schema_build_ms: schemaBuildMs,
                      kind: Tool.definitionMetadata(item).kind,
                      namespace: Tool.definitionMetadata(item).namespace,
                      latency_class: Tool.definitionMetadata(item).latencyClass,
                    })
                    .pipe(Effect.ignore)
                }
                if (options.abortSignal?.aborted) {
                  yield* input.processor.completeToolCall(options.toolCallId, output)
                }
                return output
              }),
            )
          },
        })
      }

      const nativeWebSearchAllowed =
        input.tools?.websearch !== false &&
        (!whitelist || whitelist.has("websearch") || whitelist.has("native_web_search"))
      if (nativeWebSearchAllowed && !input.nativeWebSearchBlocked) {
        const nativeWebSearch = yield* Effect.tryPromise({
          try: () => nativeWebSearchTool(input.model),
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => {
            log.warn("provider-native web search is unavailable; keeping local fallback", {
              providerID: input.model.providerID,
              modelID: input.model.id,
              error: error instanceof Error ? error.message : String(error),
            })
            return Effect.succeed(undefined)
          }),
        )
        if (nativeWebSearch) tools.native_web_search = nativeWebSearch
      }

      const codegraphUser = input.messages.findLast((message) => message.info.role === "user")
      const codegraphText =
        codegraphUser?.parts
          .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.ignored && !part.synthetic)
          .map((part) => part.text)
          .join("\n") ?? ""
      const codegraphRequested = shouldUseCodegraph(codegraphText)
      const ensureCodegraph = mcp.ensureCodegraph
      const codegraphReadiness =
        codegraphRequested &&
        ensureCodegraph &&
        codegraphUser &&
        !codegraphUnavailableRequests.has(codegraphUser.info.id)
          ? yield* ensureCodegraph()
          : undefined
      const codegraphMode =
        !codegraphRequested ||
        (codegraphUser && codegraphUnavailableRequests.has(codegraphUser.info.id)) ||
        codegraphReadiness?.status === "failed" ||
        codegraphReadiness?.status === "unavailable"
          ? "off"
          : "auto"
      const connectedMcpTools = yield* mcp.tools({ codegraph: codegraphMode })
      if (
        codegraphReadiness &&
        (codegraphReadiness.status === "failed" || codegraphReadiness.status === "unavailable")
      ) {
        if (codegraphUser) codegraphUnavailableRequests.add(codegraphUser.info.id)
        if (!codegraphFallbackNotified.has(input.session.id)) {
          codegraphFallbackNotified.add(input.session.id)
          codegraphUser?.parts.push({
            id: PartID.ascending(),
            messageID: codegraphUser.info.id,
            sessionID: input.session.id,
            type: "text",
            synthetic: true,
            text: codegraphFallbackReminder(
              codegraphReadiness.status === "failed" ? codegraphReadiness.error : codegraphReadiness.reason,
            ),
          })
        }
      }
      const mcpSearchTool = tool({
        description:
          "Search connected MCP tools by name or keyword. The result includes the exact name and input schema required by mcp_use_tool.",
        inputSchema: z.object({
          query: z.string().optional().describe("Tool name or keyword. Omit to list the first tools."),
          limit: z.coerce.number().int().min(1).max(20).optional().describe("Maximum number of tools to return."),
        }),
        execute: async ({ query, limit = 10 }) => {
          const needle = query?.trim().toLowerCase()
          const matches = Object.entries(connectedMcpTools)
            .filter(([name, item]) => {
              if (!needle) return true
              return `${name} ${item.description ?? ""}`.toLowerCase().includes(needle)
            })
            .slice(0, limit)
            .map(([name, item]) => ({
              name,
              description: item.description,
              input_schema: asSchema(item.inputSchema).jsonSchema,
            }))
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ tools: matches }, null, 2) }],
          }
        },
      })
      const mcpUseTool = tool({
        description:
          "Execute one exact MCP tool returned by mcp_search_tool. Search first when the tool name or arguments are uncertain.",
        inputSchema: z.object({
          name: z.string().min(1).describe("Exact MCP tool name returned by mcp_search_tool."),
          arguments: z
            .record(z.string(), z.unknown())
            .default({})
            .describe("Arguments matching the discovered input schema."),
        }),
        execute: async ({ name, arguments: args }, options) => {
          const item = connectedMcpTools[name]
          if (!item?.execute) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `MCP tool '${name}' was not found. Search MCP tools first.` }],
            }
          }
          if (whitelist && !whitelist.has(name) && !whitelist.has("mcp_use_tool")) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: rejectionFor(name).output }],
            }
          }
          const nextArgs =
            name.startsWith("playwright_") && args && typeof args === "object" && !Array.isArray(args)
              ? { ...args, _lfcodeSessionID: input.session.id }
              : args
          return item.execute(nextArgs, options)
        },
      })
      const directCodegraph = connectedMcpTools.codegraph_explore
      if (directCodegraph && tools.codegraph_explore) {
        log.warn("CodeGraph direct tool name collides with a registered tool; keeping the registered tool", {
          tool: "codegraph_explore",
        })
      }
      const mcpFacadeTools: Record<string, AITool> = {
        mcp_search_tool: mcpSearchTool,
        mcp_use_tool: mcpUseTool,
        ...(directCodegraph && !tools.codegraph_explore ? { codegraph_explore: directCodegraph } : {}),
      }
      for (const [key, item] of Object.entries(mcpFacadeTools)) {
        const execute = item.execute
        if (!execute) continue

        const schemaBuildStartedAt = Date.now()
        const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
        const transformed = ProviderTransform.schema(input.model, schema)
        const schemaBuildMs = Date.now() - schemaBuildStartedAt
        item.inputSchema = jsonSchema(transformed)
        item.execute = (args, opts) =>
          run.promise(
            Effect.gen(function* () {
              const startTs = Date.now()
              const callID = opts?.toolCallId ?? "?"
              log.debug("tool execute start (mcp)", {
                tool: key,
                callID,
                sessionID: input.session.id,
              })
              const ctx = context(args, opts)
              if (whitelist && !whitelist.has(key)) {
                const rejection = rejectionFor(key)
                const output = {
                  title: rejection.title,
                  metadata: rejection.metadata,
                  output: rejection.output,
                  attachments: [],
                  content: [{ type: "text" as const, text: rejection.output }],
                }
                log.debug("tool execute rejected (mcp)", {
                  tool: key,
                  callID,
                  durationMs: Date.now() - startTs,
                })
                yield* input.processor.completeToolCall(opts.toolCallId, output)
                return output
              }
              if (userExtensionsEnabled) {
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                  { args },
                )
              }
              yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
              const nextArgs =
                key.startsWith("playwright_") && args && typeof args === "object" && !Array.isArray(args)
                  ? { ...(args as Record<string, unknown>), _lfcodeSessionID: ctx.sessionID }
                  : args
              const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.promise(() =>
                execute(nextArgs, opts),
              )
              log.debug("tool execute done (mcp)", {
                tool: key,
                callID,
                durationMs: Date.now() - startTs,
                ok: true,
              })
              if (userExtensionsEnabled) {
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                  result,
                )
              }

              const textParts: string[] = []
              if (userExtensionsEnabled) {
                yield* bus
                  .publish(Metrics.ToolCall, {
                    sessionID: ctx.sessionID,
                    tool_name: key,
                    input_bytes: Metrics.jsonByteLength(args),
                    output_bytes: Metrics.jsonByteLength(result.content ?? ""),
                    tool_call_id: opts.toolCallId,
                    tool_call_status: "success",
                    execute_ms: Date.now() - startTs,
                    schema_build_ms: schemaBuildMs,
                  })
                  .pipe(Effect.ignore)
              }
              const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
              for (const contentItem of result.content) {
                if (contentItem.type === "text") textParts.push(contentItem.text)
                else if (contentItem.type === "image") {
                  attachments.push({
                    type: "file",
                    mime: contentItem.mimeType,
                    url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                  })
                } else if (contentItem.type === "resource") {
                  const { resource } = contentItem
                  if (resource.text) textParts.push(resource.text)
                  if (resource.blob) {
                    attachments.push({
                      type: "file",
                      mime: resource.mimeType ?? "application/octet-stream",
                      url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                      filename: resource.uri,
                    })
                  }
                }
              }

              const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
              const metadata = {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputRef: truncated.outputRef }),
              }

              const output = {
                title: "",
                metadata,
                output: truncated.content,
                attachments: attachments.map((attachment) => ({
                  ...attachment,
                  id: PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: input.processor.message.id,
                })),
                content: result.content,
              }
              if (opts.abortSignal?.aborted) {
                yield* input.processor.completeToolCall(opts.toolCallId, output)
              }
              return output
            }),
          )
        tools[key] = item
      }

      return tools
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: MessageV2.SubtaskPart
      model: Provider.Model
      lastUser: MessageV2.User
      sessionID: SessionID
      session: Session.Info
      msgs: MessageV2.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { actor: actorTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID, task.agent) : model
      const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        agentID: lastUser.agentID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      const taskPrompt = [
        task.prompt,
        task.contextRefs.length > 0
          ? [
              "<subtask-context>",
              "The parent explicitly attached these references. Read only the relevant ones from the shared workspace before acting:",
              ...task.contextRefs.map((ref) => `- ${ref}`),
              "</subtask-context>",
            ].join("\n")
          : undefined,
      ]
        .filter((value): value is string => !!value)
        .join("\n\n")
      const taskArgs = {
        operation: {
          action: task.execution === "background" ? ("spawn" as const) : ("run" as const),
          prompt: taskPrompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
          context: task.context,
          context_refs: task.contextRefs,
          declared_files: task.declaredFiles,
          ...(task.model ? { model: `${task.model.providerID}/${task.model.modelID}` } : {}),
          ...(task.research ? { research: task.research } : {}),
        },
      }
      let part: MessageV2.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: ActorTool.id,
        state: {
          status: "running",
          input: taskArgs,
          time: { start: Date.now() },
        },
      })
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: ActorTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* actorTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          // This is a server-authored SubtaskPart, not an LLM tool call. The
          // coordinator is intentionally hidden from normal actor discovery,
          // so mark the call as internal while retaining the regular runtime
          // delegation and permission checks for its child researchers.
          extra: { bypassAgentCheck: true, internalSubtask: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies MessageV2.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: ActorTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        agentID: lastUser.agentID,
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the actor tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput) {
      const ctx = yield* InstanceState.context
      const run = yield* runner()
      const session = yield* sessions.get(input.sessionID)
      if (session.revert) {
        yield* revert.cleanup(session)
      }
      const agent = yield* agents.get(input.agent)
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const inputModel = input.modelRef
        ? yield* provider
            .resolveModelRef(input.modelRef)
            .pipe(Effect.map((m) => ({ providerID: m.providerID, modelID: m.id })))
        : input.model
      const agentModel = agent.modelRef
        ? yield* provider
            .resolveModelRef(agent.modelRef)
            .pipe(Effect.map((m) => ({ providerID: m.providerID, modelID: m.id })))
        : agent.model
      const model = inputModel ?? agentModel ?? (yield* lastModel(input.sessionID))
      const userMsg: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        sessionID: input.sessionID,
        time: { created: Date.now() },
        role: "user",
        agent: input.agent,
        model: { providerID: model.providerID, modelID: model.modelID },
      }
      yield* sessions.updateMessage(userMsg)
      const userPart: MessageV2.Part = {
        type: "text",
        id: PartID.ascending(),
        messageID: userMsg.id,
        sessionID: input.sessionID,
        text: "The following tool was executed by the user",
        synthetic: true,
      }
      yield* sessions.updatePart(userPart)

      const msg: MessageV2.Assistant = {
        id: MessageID.ascending(),
        sessionID: input.sessionID,
        parentID: userMsg.id,
        agentID: userMsg.agentID,
        mode: input.agent,
        agent: input.agent,
        cost: 0,
        path: { cwd: ctx.directory, root: ctx.worktree },
        time: { created: Date.now() },
        role: "assistant",
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: model.modelID,
        providerID: model.providerID,
      }
      yield* sessions.updateMessage(msg)
      const part: MessageV2.ToolPart = {
        type: "tool",
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: input.sessionID,
        tool: "shell",
        callID: ulid(),
        state: {
          status: "running",
          time: { start: Date.now() },
          input: { command: input.command },
        },
      }
      yield* sessions.updatePart(part)

      const sh = Shell.preferred()
      const shellName = (
        process.platform === "win32" ? path.win32.basename(sh, ".exe") : path.basename(sh)
      ).toLowerCase()
      const invocations: Record<string, { args: string[] }> = {
        nu: { args: ["-c", input.command] },
        fish: { args: ["-c", input.command] },
        zsh: {
          args: [
            "-l",
            "-c",
            `
              __oc_cwd=$PWD
              [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
              [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
              cd "$__oc_cwd"
              eval ${JSON.stringify(input.command)}
            `,
          ],
        },
        bash: {
          args: [
            "-l",
            "-c",
            `
              __oc_cwd=$PWD
              shopt -s expand_aliases
              [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
              cd "$__oc_cwd"
              eval ${JSON.stringify(input.command)}
            `,
          ],
        },
        cmd: { args: ["/c", input.command] },
        powershell: { args: ["-NoProfile", "-Command", input.command] },
        pwsh: { args: ["-NoProfile", "-Command", input.command] },
        "": { args: ["-c", input.command] },
      }

      const args = (invocations[shellName] ?? invocations[""]).args
      const cwd = ctx.directory
      const shellEnv = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: input.sessionID, callID: part.callID },
        { env: {} },
      )

      const cmd = ChildProcess.make(sh, args, {
        cwd,
        extendEnv: true,
        env: { ...shellEnv.env, TERM: "dumb" },
        stdin: "ignore",
        forceKillAfter: "3 seconds",
      })

      let output = ""
      let aborted = false

      const finish = Effect.uninterruptible(
        Effect.gen(function* () {
          if (aborted) {
            output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
          }
          if (!msg.time.completed) {
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          }
          if (part.state.status === "running") {
            part.state = {
              status: "completed",
              time: { ...part.state.time, end: Date.now() },
              input: part.state.input,
              title: "",
              metadata: { output, description: "" },
              output,
            }
            yield* sessions.updatePart(part)
          }
        }),
      )

      const exit = yield* Effect.gen(function* () {
        const handle = yield* spawner.spawn(cmd)
        yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
          Effect.sync(() => {
            output += chunk
            if (part.state.status === "running") {
              part.state.metadata = { output, description: "" }
              void run.fork(sessions.updatePart(part))
            }
          }),
        )
        yield* handle.exitCode
      }).pipe(
        Effect.scoped,
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            aborted = true
          }),
        ),
        Effect.orDie,
        Effect.ensuring(finish),
        Effect.exit,
      )

      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
        return yield* Effect.failCause(exit.cause)
      }

      return { info: msg, parts: [part] }
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
      agentName?: string,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          visible: agentName !== "context-reviewer",
          error: new NamedError.Unknown({
            message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.failCause(exit.cause)
    })

    const lastModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model, {
        agentID: "*",
      })
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel()
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent || (yield* agents.defaultAgent())
      const ag = yield* agents.get(agentName)
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: error.toObject(),
          visible: input.agent !== "context-reviewer",
        })
        throw error
      }

      const inputModel = input.modelRef
        ? yield* provider
            .resolveModelRef(input.modelRef)
            .pipe(Effect.map((m) => ({ providerID: m.providerID, modelID: m.id })))
        : input.model
      const agentModel = ag.modelRef
        ? yield* provider
            .resolveModelRef(ag.modelRef)
            .pipe(Effect.map((m) => ({ providerID: m.providerID, modelID: m.id })))
        : ag.model
      const model = inputModel ?? agentModel ?? (yield* lastModel(input.sessionID))
      const same = agentModel && model.providerID === agentModel.providerID && model.modelID === agentModel.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.catchDefect(() => Effect.void))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        agentID: input.agentID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        tavernContext: input.tavernContext,
        format: input.format,
        source: input.source ?? "user",
        provenance: input.provenance,
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })
      const explicitAgentPrompt = input.parts
        .filter((part): part is Extract<PromptInput["parts"][number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim()
      const explicitContextRefs = [
        ...new Set(
          input.parts.flatMap((part) => {
            if (part.type !== "file") return []
            if (part.source?.type === "resource") return [part.source.uri]
            if (part.source?.type === "file" || part.source?.type === "symbol") return [part.source.path]
            return []
          }),
        ),
      ]

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              if (yield* fsys.isDir(filepath)) part.mime = "application/x-directory"

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<MessageV2.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                    visible: input.agent !== "context-reviewer",
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                    visible: input.agent !== "context-reviewer",
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${part.mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const target = yield* agents.get(part.name)
          const context =
            target?.defaultContext === "full" ? "full" : target?.defaultContext === "task" ? "none" : "state"
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "subtask",
              agent: part.name,
              description: `@${part.name}`,
              prompt: explicitAgentPrompt || `Handle the user's request as the ${part.name} specialist.`,
              execution: target?.defaultExecution ?? "wait",
              context,
              contextRefs: explicitContextRefs,
              declaredFiles: explicitContextRefs.filter((ref) => !ref.includes("://")),
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const parts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )
      const requestText = parts
        .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
        .map((part) => part.text)
        .join("\n")
        .trim()
      if (input.agent !== "context-reviewer") {
        yield* plugin.trigger(
          "chat.message",
          {
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            messageID: input.messageID,
            variant: input.variant,
          },
          { message: info, parts },
        )
      }

      const parsed = MessageV2.Info.safeParse(info)
      if (!parsed.success) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          issues: parsed.error.issues,
        })
      }
      parts.forEach((part, index) => {
        const p = MessageV2.Part.safeParse(part)
        if (p.success) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          issues: p.error.issues,
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      if (input.source !== "spawn" && input.source !== "hook" && parts.some(isRealUserPart)) {
        yield* sessions.setLastUserActivity({ sessionID: input.sessionID, at: info.time.created })
      }

      return { info, parts }
    }, Effect.scoped)

    const sweepOrphanAssistants = Effect.fn("SessionPrompt.sweepOrphanAssistants")(function* (
      sessionID: SessionID,
      options?: SweepOrphanAssistantsOptions,
    ) {
      yield* Effect.sync(() => Session.clearOrphanAssistants({ sessionID, ...options }))
    })

    const wakePendingSteer = Effect.fn("SessionPrompt.wakePendingSteer")(function* (
      sessionID: SessionID,
      agentID?: string,
      task_id?: string,
    ) {
      if (steerWakeups.has(sessionID)) return
      steerWakeups.add(sessionID)
      yield* Effect.gen(function* () {
        while (true) {
          const pending = yield* state.hasPendingSteer(sessionID)
          if (!pending) return
          const busy = yield* state.assertNotBusy(sessionID).pipe(Effect.exit)
          if (Exit.isSuccess(busy)) {
            yield* loop({ sessionID, agentID: agentID ?? "main", task_id }).pipe(Effect.ignore)
            return
          }
          yield* Effect.sleep("25 millis")
        }
      }).pipe(
        Effect.catchCause((cause) =>
          elog.error("pending steer wake failed", {
            sessionID,
            error: Cause.squash(cause),
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            steerWakeups.delete(sessionID)
          }),
        ),
        Effect.forkIn(scope),
      )
    })

    const prompt: Interface["prompt"] = Effect.fn("SessionPrompt.prompt")(function* (
      input: PromptInput,
      options?: PromptRunOptions,
    ) {
        const session = yield* sessions.get(input.sessionID)
        const userExtensionsEnabled = input.agent !== "context-reviewer"
        if (userExtensionsEnabled && !hookStarted.has(input.sessionID)) {
          hookStarted.add(input.sessionID)
          yield* Effect.promise(() =>
            dispatchHooks({
              event: "SessionStart",
              sessionID: input.sessionID,
              projectID: String(session.projectID),
              cwd: session.directory,
              payload: { source: input.source ?? "user" },
            }),
          )
        }
        if (userExtensionsEnabled) {
          const submitted = yield* Effect.promise(() =>
            dispatchHooks({
              event: "UserPromptSubmit",
              sessionID: input.sessionID,
              projectID: String(session.projectID),
              cwd: session.directory,
              payload: { parts: input.parts },
            }),
          )
          if (submitted.blocked) throw new Error("User prompt was blocked by a Hook")
        }
        if (input.source !== "spawn" && input.source !== "hook") {
          yield* revert.cleanup(session)
          yield* sweepOrphanAssistants(input.sessionID)
        }
        const message = yield* createUserMessage(input)
        // Completion wakes are intentionally bounded while an owner is idle.
        // Only a real user admission re-arms that budget; spawned agents,
        // hooks, and automations must not keep a dormant session waking forever.
        if ((input.source ?? "user") === "user") {
          if (inbox.resetCompletionWakeBudget) {
            yield* inbox.resetCompletionWakeBudget({
              sessionID: input.sessionID,
              actorID: input.agentID ?? "main",
            })
          }
        }
        if (input.delivery === "steer") {
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: message.info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            ignored: true,
            text: STEER_MARKER,
          })
        }
        yield* sessions.touch(input.sessionID)

        const permissions: Permission.Ruleset = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          session.permission = permissions
          yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
        }

        if (input.noReply === true) return message
        if (input.delivery === "steer") {
          const busy = yield* state.assertNotBusy(input.sessionID).pipe(Effect.exit)
          if (Exit.isFailure(busy)) {
            yield* state.noteSteer(input.sessionID, message.info.id)
            yield* wakePendingSteer(input.sessionID, input.agentID, input.task_id)
            return message
          }
        }
        const result = loop(
          {
            sessionID: input.sessionID,
            agentID: input.agentID ?? "main",
            task_id: input.task_id,
            permission: options?.permission,
            interactive: options?.interactive,
            onPermissionRequest: options?.onPermissionRequest,
            onQuestionRequest: options?.onQuestionRequest,
          },
          options?.abortSignal,
        )
        return yield* result
      },
    )

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID, agentID?: string) {
      if (agentID !== undefined) {
        // Agent-scoped: return THIS agent's newest message (assistant preferred).
        // Critical for concurrent same-session subagents — a session-wide lookup
        // collapses concurrent actors' return values onto whichever finished last.
        // messages() yields oldest-first/newest-last, so findLast picks the newest
        // assistant and the last element is the newest message overall.
        const own = yield* sessions.messages({ sessionID, agentID })
        const lastAsst = own.findLast((m) => m.info.role === "assistant")
        if (lastAsst) return lastAsst
        if (own.length > 0) return own[own.length - 1]
        // fall through to session-wide if this agent has no messages yet
      }
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user", { agentID: "*" })
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1, agentID: "*" })
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const interruptedAssistant = Effect.fnUntraced(function* (sessionID: SessionID, agentID?: string) {
      const message = yield* lastAssistant(sessionID, agentID)
      if (message.info.role !== "assistant" || message.info.error) return message
      const info = {
        ...message.info,
        time: { ...message.info.time, completed: message.info.time.completed ?? Date.now() },
        error: new MessageV2.AbortedError({ message: "User cancelled the response" }).toObject(),
      }
      yield* sessions.updateMessage(info)
      return { ...message, info }
    })

    const runLoop: (
      sessionID: SessionID,
      agentID?: string,
      task_id?: string,
      abortSignal?: AbortSignal,
      options?: PromptRunOptions,
    ) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.run")(function* (
      sessionID: SessionID,
      agentID?: string,
      task_id?: string,
      abortSignal?: AbortSignal,
      options?: PromptRunOptions,
    ) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown | undefined
        let step = 0
        let reviewHandoff: ContextReviewRecord | undefined
        let reviewSource: MessageV2.WithParts | undefined
        const session = yield* sessions.get(sessionID)
        let lastFinishedForPrune: MessageV2.Assistant | undefined
        let lastModelForPrune: Provider.Model | undefined
        let outputLengthContinuations = 0
        // Shared local counter for "model finished but produced nothing usable"
        // (think-only / empty). T04's generic-invalid retries reuse this same
        // counter — do not add a second one. Local to runLoop so a fresh user
        // turn resets it (no cross-message pollution), same as outputLengthContinuations.
        let invalidContinuations = 0
        // Missing-finish-step is a separate failure mode: the provider stream
        // died before emitting a completion event. Keep its retry budget
        // independent from invalid output so one class does not consume the other.
        let interruptedContinuations = 0
        // A provider-executed native search has no local execute closure where
        // the configured direct or browser route can run. Allow one synthetic
        // re-entry when it returns no verifiable citations or an error.
        let nativeWebSearchFallbacks = 0
        // structured-output 专用 retry：上限来自 lastUser.format.retryCount（默认 2），
        // 与 invalidContinuations（generic invalid）分离，互不污染。局部于 runLoop，
        // 新一轮用户 turn 自动归零。
        let structuredRetries = 0
        const hasSteerMarker = (msg: MessageV2.WithParts) =>
          msg.info.role === "user" &&
          msg.parts.some((part) => part.type === "text" && part.synthetic && part.ignored && part.text === STEER_MARKER)

        const steerTextParts = (msg: MessageV2.WithParts) =>
          msg.parts.filter(
            (part): part is MessageV2.TextPart =>
              part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
          )

        const mergeSteerFollowups = (
          messages: MessageV2.WithParts[],
          lastFinished: MessageV2.Assistant | undefined,
          pendingSteerIDs?: MessageID[],
        ) => {
          if (!lastFinished) return
          const pending =
            pendingSteerIDs && pendingSteerIDs.length > 0
              ? new Set<string>(pendingSteerIDs.map((id) => String(id)))
              : undefined
          const steer = messages.filter(
            (msg) =>
              msg.info.id > lastFinished.id &&
              hasSteerMarker(msg) &&
              steerTextParts(msg).length > 0 &&
              (!pending || pending.has(String(msg.info.id))),
          )
          if (steer.length === 0) return
          const target = steer.at(-1)
          if (!target || target.info.role !== "user") return
          const merged = steer.flatMap((msg) => steerTextParts(msg).map((part) => part.text.trim())).filter(Boolean)
          if (merged.length === 0) return
          for (const msg of steer) {
            for (const part of msg.parts) {
              if (part.type !== "text" || part.synthetic || part.ignored) continue
              part.ignored = true
            }
          }
          target.parts.push({
            id: PartID.ascending(),
            messageID: target.info.id,
            sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "The user sent the following follow-up message(s) while you were working:",
              ...merged,
              "",
              "Please address these follow-up message(s) and continue with your tasks.",
              "</system-reminder>",
            ].join("\n"),
          })
        }
        const resetContinuationBudgets = (assistant: MessageV2.Assistant, parts: MessageV2.Part[]) => {
          if (!hasUsableAssistantProgress(assistant, parts)) return
          if (invalidContinuations === 0 && interruptedContinuations === 0) return
          const previous = {
            invalidContinuations,
            interruptedContinuations,
          }
          invalidContinuations = 0
          interruptedContinuations = 0
          return previous
        }
        const agentMetrics = { tokens_in: 0, tokens_out: 0, files_changed: 0 }
        const publishAgentRequest = (phase: string, taskType: string) =>
          bus
            .publish(Metrics.AgentRequest, {
              sessionID,
              phase,
              task_type: taskType,
              surface: Flag.LFCODE_CLIENT,
              total_tokens_in: agentMetrics.tokens_in,
              total_tokens_out: agentMetrics.tokens_out,
              files_changed: agentMetrics.files_changed,
              validation_status: "skipped",
            })
            .pipe(Effect.ignore)
        // Trim freed space but `lastFinished.tokens` still reflects pre-trim state.
        // Skip one overflow check so the model can respond on the trimmed context;
        // its new assistant message will carry accurate tokens for the next check.
        let skipOverflowCheck = false

        // Contract (T05): on finish="length", inject a continuation nudge ONLY for
        // plain text. If any non-providerExecuted client tool part exists we bail
        // (return false) and let classify route the normal tool-observation re-loop.
        // This guarantees "no output-length continuation when a tool is involved" —
        // it does NOT guarantee a stream-time-truncated tool never executed, since
        // the AI SDK runs tools mid-stream before the finish reason is known.
        const autoContinueOutputLength = Effect.fn("SessionPrompt.autoContinueOutputLength")(function* (input: {
          lastUser: MessageV2.User
          assistant: MessageV2.Assistant
        }) {
          if (input.assistant.finish !== "length" || input.assistant.error || input.assistant.summary) return false
          if (
            MessageV2.parts(input.assistant.id).some((part) => part.type === "tool" && !part.metadata?.providerExecuted)
          ) {
            return false
          }
          if (outputLengthContinuations >= OUTPUT_LENGTH_CONTINUATION_LIMIT) {
            input.assistant.error = new MessageV2.OutputLengthError({}).toObject()
            yield* sessions.updateMessage(input.assistant)
            yield* bus.publish(Session.Event.Error, {
              sessionID: input.assistant.sessionID,
              error: input.assistant.error,
              visible: !isUserHiddenSystemActorID(input.assistant.agentID),
            })
            return false
          }

          outputLengthContinuations++
          yield* slog.info("auto-continuing output length", { attempt: outputLengthContinuations })
          const msg = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID: input.lastUser.sessionID,
            agentID: input.lastUser.agentID,
            agent: input.lastUser.agent,
            model: input.lastUser.model,
            tools: input.lastUser.tools,
            format: input.lastUser.format,
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: msg.sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "The previous assistant response hit the model output token limit before completing.",
              "Continue the same task from the exact point where it stopped.",
              "Do not restart, recap, or repeat prior reasoning. Keep reasoning concise, prefer concrete tool calls or final output, and only stop when the user's task is complete or genuinely blocked.",
              "</system-reminder>",
            ].join("\n"),
          } satisfies MessageV2.TextPart)
          return true
        })

        const reenterWithReminder = Effect.fn("SessionPrompt.reenterWithReminder")(function* (input: {
          lastUser: MessageV2.User
          text: string
        }) {
          const reentry = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID,
            agentID: input.lastUser.agentID,
            agent: input.lastUser.agent,
            model: input.lastUser.model,
            tools: input.lastUser.tools,
            format: input.lastUser.format,
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: reentry.id,
            sessionID,
            type: "text",
            synthetic: true,
            text: input.text,
          } satisfies MessageV2.TextPart)
        })

        // Goal stop-condition gate (main agent only). Before honoring a stop,
        // an independent judge model reads the transcript and decides whether
        // the active goal is satisfied. Not satisfied → inject the judge's
        // reason as a synthetic user turn and signal the caller to keep working
        // (return true). This is the main-loop analogue of actor.preStop ReAct
        // re-entry, which only fires for spawned actors. fail-open on any judge
        // error so a flaky judge can never trap the user.
        const goalGate = Effect.fn("SessionPrompt.goalGate")(function* (lastUser: MessageV2.User) {
          if ((agentID ?? "main") !== "main") return false
          const active = yield* goal.getActive(sessionID)
          if (!active) return false

          const transcriptMsgs = yield* MessageV2.filterCompactedEffect(sessionID, {
            contextFrom: session.contextFrom,
            contextWatermark: session.contextWatermark,
            agentID: "main",
          })
          // Anchor the verdict to the assistant turn the judge just evaluated, so
          // the TUI can render a per-turn marker the user can trace back to.
          const judgedMessageID = transcriptMsgs.findLast((m) => m.info.role === "assistant")?.info.id
          const completion = yield* goal.requestComplete({
            sessionID,
            msgs: transcriptMsgs,
            model: lastUser.model,
            messageID: judgedMessageID,
          })

          if (completion.completed) {
            yield* slog.info("goal satisfied; allowing stop", {
              sessionID,
              impossible: completion.verdict?.impossible === true,
              error: completion.verdict?.error === true,
            })
            return false
          }

          const verdict = completion.verdict
          if (!verdict) return false

          const count = yield* goal.bumpReact(sessionID)
          if (count > MAX_GOAL_REACT) {
            yield* slog.warn("goal hit MAX_GOAL_REACT cap; allowing stop", {
              sessionID,
              condition: active.condition,
              count,
            })
            yield* goal.clear(sessionID)
            return false
          }

          yield* slog.info("goal not satisfied; re-entering", { sessionID, attempt: count })
          const reentry = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID,
            agentID: lastUser.agentID,
            agent: lastUser.agent,
            model: lastUser.model,
            tools: lastUser.tools,
            format: lastUser.format,
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: reentry.id,
            sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              `Your goal is not yet satisfied: "${active.condition}".`,
              "A judge reviewed the transcript and reported what is still missing:",
              verdict.reason,
              "Keep working toward the goal. Do not stop until it is genuinely met or impossible.",
              "</system-reminder>",
            ].join("\n"),
          } satisfies MessageV2.TextPart)
          return true
        })

        // think-only (reasoning only) / empty (nothing at all) steps finish with
        // a non-tool stop but carry no usable answer. Without intervention the loop
        // breaks and hands the user an assistant with no final text. Nudge the model
        // to produce a final answer or call a real tool; give up (write a terminal
        // error) once the shared counter is exhausted so we never loop forever.
        const autoContinueInvalidOutput = Effect.fn("SessionPrompt.autoContinueInvalidOutput")(function* (input: {
          lastUser: MessageV2.User
          assistant: MessageV2.Assistant
          reason: string
        }) {
          if (input.assistant.error || input.assistant.summary || input.assistant.structured !== undefined) return false
          if (invalidContinuations >= INVALID_OUTPUT_CONTINUATION_LIMIT) {
            input.assistant.error = new MessageV2.InvalidOutputError({ message: input.reason }).toObject()
            yield* sessions.updateMessage(input.assistant)
            yield* bus.publish(Session.Event.Error, {
              sessionID: input.assistant.sessionID,
              error: input.assistant.error,
              visible: !isUserHiddenSystemActorID(input.assistant.agentID),
            })
            return false
          }

          invalidContinuations++
          yield* slog.info("auto-continuing invalid output", { attempt: invalidContinuations, reason: input.reason })
          const msg = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID: input.lastUser.sessionID,
            agentID: input.lastUser.agentID,
            agent: input.lastUser.agent,
            model: input.lastUser.model,
            tools: input.lastUser.tools,
            format: input.lastUser.format,
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: msg.sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "Your previous response contained no usable answer (it had only reasoning, or was empty).",
              "Provide a final answer to the user now, or call a valid tool to make progress on the task.",
              "Do not respond with only reasoning/thinking.",
              "</system-reminder>",
            ].join("\n"),
          } satisfies MessageV2.TextPart)
          return true
        })

        const autoContinueInterruptedOutput = Effect.fn("SessionPrompt.autoContinueInterruptedOutput")(
          function* (input: { lastUser: MessageV2.User; assistant: MessageV2.Assistant; parts: MessageV2.Part[] }) {
            if (!isInterruptedStreamAssistant(input.assistant, input.parts)) return false
            if (interruptedContinuations >= INTERRUPTED_OUTPUT_CONTINUATION_LIMIT) return false

            interruptedContinuations++
            yield* slog.info("auto-continuing interrupted output", { attempt: interruptedContinuations })
            const msg = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user" as const,
              sessionID: input.lastUser.sessionID,
              agentID: input.lastUser.agentID,
              agent: input.lastUser.agent,
              model: input.lastUser.model,
              tools: input.lastUser.tools,
              format: input.lastUser.format,
              time: { created: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: msg.sessionID,
              type: "text",
              synthetic: true,
              text: [
                "<system-reminder>",
                "Your previous step was interrupted before the model emitted a completion event.",
                "Continue the same task from the interruption point.",
                "Do not restart from scratch and do not repeat completed tool calls unless their prior result is missing or unusable.",
                "First inspect any completed tool results already in the conversation, then continue.",
                "</system-reminder>",
              ].join("\n"),
            } satisfies MessageV2.TextPart)
            return true
          },
        )

        const autoContinueNativeWebSearchFallback = Effect.fn("SessionPrompt.autoContinueNativeWebSearchFallback")(
          function* (input: { lastUser: MessageV2.User; parts: MessageV2.Part[] }) {
            if (nativeWebSearchFallbacks >= 1 || input.lastUser.tools?.websearch === false) return false
            const failed = input.parts.some(
              (part) =>
                part.type === "tool" &&
                part.tool === "native_web_search" &&
                part.metadata?.providerExecuted === true &&
                part.state.status === "completed" &&
                part.state.metadata?.fallbackRecommended === true,
            )
            if (!failed) return false
            nativeWebSearchFallbacks++
            yield* slog.info("provider-native web search needs local fallback", { attempt: nativeWebSearchFallbacks })
            yield* reenterWithReminder({
              lastUser: input.lastUser,
              text: [
                "<system-reminder>",
                "The provider-native web search failed or returned no verifiable URL citations.",
                "Use the local websearch tool now. It follows the configured direct or browser discovery route; use a legacy compatibility provider only when explicitly selected. Do not retry native_web_search.",
                "</system-reminder>",
              ].join("\n"),
            })
            return true
          },
        )

        // json_schema mode but the model never produced structured output (plain
        // text stop, empty, think-only, or any other non-tool terminal). Retry up
        // to lastUser.format.retryCount with a repair nudge; on exhaustion write a
        // StructuredOutputError carrying the *real* retry count. Separate from
        // invalidContinuations: structured retries are bounded by the per-request
        // retryCount, not the generic invalid-output limit.
        const autoRetryStructuredOutput = Effect.fn("SessionPrompt.autoRetryStructuredOutput")(function* (input: {
          lastUser: MessageV2.User
          assistant: MessageV2.Assistant
        }) {
          if (input.assistant.error || input.assistant.summary || input.assistant.structured !== undefined) return false
          const limit = input.lastUser.format?.type === "json_schema" ? input.lastUser.format.retryCount : 0
          if (structuredRetries >= limit) {
            input.assistant.error = new MessageV2.StructuredOutputError({
              message: "Model did not produce structured output",
              retries: structuredRetries,
            }).toObject()
            yield* sessions.updateMessage(input.assistant)
            yield* bus.publish(Session.Event.Error, {
              sessionID: input.assistant.sessionID,
              error: input.assistant.error,
              visible: !isUserHiddenSystemActorID(input.assistant.agentID),
            })
            return false
          }

          structuredRetries++
          yield* slog.info("retrying structured output", { attempt: structuredRetries })
          const msg = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID: input.lastUser.sessionID,
            agentID: input.lastUser.agentID,
            agent: input.lastUser.agent,
            model: input.lastUser.model,
            tools: input.lastUser.tools,
            // Must carry format so the next iteration re-registers the StructuredOutput tool.
            format: input.lastUser.format,
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: msg.sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "Your previous response did not produce valid structured output via the StructuredOutput tool",
              "(it was plain text, empty, or only reasoning).",
              "You MUST call the StructuredOutput tool now, passing JSON that matches the requested schema.",
              "Do not reply with plain text and do not respond with only reasoning/thinking.",
              "</system-reminder>",
            ].join("\n"),
          } satisfies MessageV2.TextPart)
          return true
        })

        // content-filter is terminal on first occurrence: re-sending the same
        // turn would just get filtered again, so there is no nudge / counter.
        // Write a user-visible error (rendered via the session.error toast) and
        // let the caller break.
        const writeContentFilterError = Effect.fn("SessionPrompt.writeContentFilterError")(function* (input: {
          assistant: MessageV2.Assistant
        }) {
          if (input.assistant.error) return
          input.assistant.error = new MessageV2.ContentFilterError({
            message: "The response was withheld by the model provider's content safety filter.",
          }).toObject()
          yield* sessions.updateMessage(input.assistant)
          yield* bus.publish(Session.Event.Error, {
            sessionID: input.assistant.sessionID,
            error: input.assistant.error,
            visible: !isUserHiddenSystemActorID(input.assistant.agentID),
          })
        })

        // A `failed` classification (model "error" finish, or an error already set
        // by the stream-error path) is terminal. If the step already carries an
        // error (e.g. APIError written when the stream threw, processor.ts:581),
        // keep it; otherwise write a ModelError so the loop never breaks silently
        // without a user-visible failure.
        const writeModelError = Effect.fn("SessionPrompt.writeModelError")(function* (input: {
          assistant: MessageV2.Assistant
          reason: string
        }) {
          if (input.assistant.error) return
          input.assistant.error = new MessageV2.ModelError({ message: input.reason }).toObject()
          yield* sessions.updateMessage(input.assistant)
          yield* bus.publish(Session.Event.Error, {
            sessionID: input.assistant.sessionID,
            error: input.assistant.error,
            visible: !isUserHiddenSystemActorID(input.assistant.agentID),
          })
        })

        const writeAbortedError = Effect.fn("SessionPrompt.writeAbortedError")(function* (assistant: MessageV2.Assistant) {
          if (assistant.error) return
          assistant.time.completed = assistant.time.completed ?? Date.now()
          assistant.error = new MessageV2.AbortedError({ message: "User cancelled the response" }).toObject()
          yield* sessions.updateMessage(assistant)
          yield* bus.publish(Session.Event.Error, {
            sessionID: assistant.sessionID,
            error: assistant.error,
            visible: !isUserHiddenSystemActorID(assistant.agentID),
          })
        })

        while (true) {
          // F55: only main agent sets session status to busy; subagent runners
          // must not touch session-level status (Runner.onBusy is Effect.void
          // for non-main actors per F47).
          yield* inbox.drain(sessionID, agentID ?? "main").pipe(Effect.ignore)
          yield* slog.info("loop", { step })

          // F37: filter by agentID so subagent slices stay isolated from the
          // main agent's slice within the same session. Without this, an actor
          // (explore/general/etc) spawned via lfcode's shared-sessionID
          // design would see the parent's full conversation here and drift
          // off-task. agentID === "main" => main agent slice (agent_id = 'main'
          // in DB), agentID === "explore-1" => only explore-1's slice.
          let msgs = yield* MessageV2.filterCompactedEffect(sessionID, {
            contextFrom: session.contextFrom,
            contextWatermark: session.contextWatermark,
            agentID: agentID ?? "main",
          })

          let lastUser: MessageV2.User | undefined
          let lastAssistant: MessageV2.Assistant | undefined
          let lastFinished: MessageV2.Assistant | undefined
          let tasks: MessageV2.SubtaskPart[] = []
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i]
            if (!lastUser && msg.info.role === "user") lastUser = msg.info
            if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
            if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
            if (lastUser && lastFinished) break
            const task = msg.parts.filter((part): part is MessageV2.SubtaskPart => part.type === "subtask")
            if (task && !lastFinished) tasks.push(...task)
          }

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
          if (!reviewSource && agentID === "main") {
            const candidate = msgs.findLast((message) => message.info.id === lastUser?.id)
            if (candidate && isReviewableMainUser(candidate)) reviewSource = candidate
          }
          const pendingSteerIDs = !agentID || agentID === "main" ? yield* state.takePendingSteer(sessionID) : []

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

          if (
            lastAssistant?.finish === "length" &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id &&
            (yield* autoContinueOutputLength({ lastUser, assistant: lastAssistant }))
          ) {
            continue
          }

          if (lastAssistant && lastUser.id < lastAssistant.id) {
            const lastAssistantParts = lastAssistantMsg?.parts ?? []
            if (yield* autoContinueNativeWebSearchFallback({ lastUser, parts: lastAssistantParts })) continue
            const classification = classifyAssistantStep({
              phase: "existing-assistant",
              lastUser,
              assistant: lastAssistant,
              parts: lastAssistantParts,
            })
            if (classification.type === "filtered") {
              yield* writeContentFilterError({ assistant: lastAssistant })
              yield* slog.info("exiting loop", { classification: classification.type })
              break
            }
            if (classification.type === "failed") {
              if (
                yield* autoContinueInterruptedOutput({
                  lastUser,
                  assistant: lastAssistant,
                  parts: lastAssistantParts,
                })
              )
                continue
              yield* writeModelError({ assistant: lastAssistant, reason: classification.reason })
              yield* slog.info("exiting loop", { classification: classification.type, reason: classification.reason })
              break
            }
            if (classification.type === "think-only" || classification.type === "invalid") {
              const reason = classification.type === "invalid" ? classification.reason : "think-only"
              if (yield* autoContinueInvalidOutput({ lastUser, assistant: lastAssistant, reason })) continue
              yield* slog.info("exiting loop", { classification: classification.type })
              break
            }
            if (classification.type === "final" && classification.degraded)
              yield* slog.warn("degraded final on abnormal finish", { finish: lastAssistant.finish })
            if (classification.type !== "continue") {
              if (yield* goalGate(lastUser)) continue
              yield* slog.info("exiting loop", { classification: classification.type })
              break
            }
          }

          if (
            repeatedToolValidationFailure({
              messages: msgs,
              threshold: REPEATED_TOOL_VALIDATION_FAILURE_THRESHOLD,
              userID: lastUser.id,
            })
          ) {
            yield* slog.warn("stopping repeated tool validation failure", {
              sessionID,
              threshold: REPEATED_TOOL_VALIDATION_FAILURE_THRESHOLD,
            })
            if (lastAssistant) {
              yield* writeModelError({
                assistant: lastAssistant,
                reason: `Stopped automatic continuation after ${REPEATED_TOOL_VALIDATION_FAILURE_THRESHOLD} identical tool validation failures. Use a different tool shape or report the provider compatibility problem instead of retrying the same invalid call.`,
              })
            }
            break
          }

          step++
          if (step === 1 && !isUserHiddenSystemActorID(lastUser.agentID))
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID, lastUser.agent)
          lastModelForPrune = model
          lastFinishedForPrune = lastFinished
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          // Detect compaction boundary: if the last user message has a compaction
          // part, route to compact.process() instead of the normal LLM flow.
          const lastUserMsgForCompaction = msgs.findLast((m) => m.info.role === "user")
          if (lastUserMsgForCompaction?.parts.some((p) => p.type === "compaction")) {
            const compactionPart = lastUserMsgForCompaction.parts.find(
              (p): p is MessageV2.CompactionPart => p.type === "compaction",
            )
            const allMsgs = yield* sessions.messages({ sessionID })
            const result = yield* compaction.process({
              parentID: lastUser.id,
              messages: allMsgs,
              sessionID,
              auto: compactionPart?.auto ?? false,
              overflow: compactionPart?.overflow,
              agentID: lastUser.agentID,
            })
            if (result === "stop") break
            continue
          }

          // Repeated-step nudge: if the last REPEATED_STEP_THRESHOLD finished
          // assistant steps made an identical tool call, the model is likely
          // stuck looping. Inject a reminder on the last user message asking it
          // to change approach. Mirrors the memory-flush nudge above (synthetic
          // text part, deduped per build).
          if (lastFinished) {
            const recentSignatures: string[] = []
            for (let i = msgs.length - 1; i >= 0 && recentSignatures.length < REPEATED_STEP_THRESHOLD; i--) {
              const m = msgs[i]
              if (m.info.role !== "assistant" || !m.info.finish) continue
              const sig = stepSignature(m.parts)
              if (sig === undefined) break
              recentSignatures.push(sig)
            }
            const repeating =
              recentSignatures.length === REPEATED_STEP_THRESHOLD &&
              recentSignatures.every((sig) => sig === recentSignatures[0])
            if (repeating) {
              const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
              if (
                lastUserMsg &&
                !lastUserMsg.parts.some((p) => p.type === "text" && p.text?.includes("repeating the same action"))
              ) {
                lastUserMsg.parts.push({
                  id: PartID.ascending(),
                  messageID: lastUserMsg.info.id,
                  sessionID,
                  type: "text",
                  synthetic: true,
                  text: [
                    "<system-reminder>",
                    `Your last ${REPEATED_STEP_THRESHOLD} steps have been identical — you appear to be`,
                    "repeating the same action without making progress. Stop and reconsider:",
                    "the current approach is not working. Try a different strategy, use a",
                    "different tool, or if you are blocked, explain the blocker to the user",
                    "instead of repeating the same step again.",
                    "</system-reminder>",
                  ].join("\n"),
                })
              }
            }
          }

          // Resolve the agent for this iteration once. Both the context-management
          // hook below and the existing
          // agent-not-found check later in the iteration reuse this binding.
          // Bounded computation agents (native + hidden — currently title,
          // summary, checkpoint-writer) are exempt from context management;
          // see docs/superpowers/specs/2026-04-28-bounded-computation-agents-design.md
          const agent = yield* agents.get(lastUser.agent)
          const isBoundedComputation = agent?.native === true && agent?.hidden === true

          const cfg = yield* config.get()
          if (!isBoundedComputation && lastFinished && cfg.compaction?.auto !== false) {
            const promptOps = yield* ops()
            yield* prune
              .fireCheckpoints({
                sessionID,
                model,
                tokens: lastFinished.tokens,
                promptOps,
                agentID: lastUser.agentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
          }
          const overflowed = !!lastFinished && overflowCheck({ cfg, tokens: lastFinished.tokens, model })
          const shouldCompact =
            !!lastFinished &&
            lastFinished.summary !== true &&
            (overflowed || shouldAutoCompact({ cfg, tokens: lastFinished.tokens, model }))

          if (!skipOverflowCheck && !isBoundedComputation && shouldCompact) {
            // Subagent overflow → per-actor compaction (lossy LLM summarization
            // scoped to the actor's (sessionID, agent_id) slice). Subagents
            // don't have checkpoints, so checkpoint+discard does not apply.
            // Gate must exclude agentID="main" — F49+F50 made main carry
            // agentID="main", so a bare `if (lastUser.agentID)` would route
            // main to this subagent path and skip the checkpoint rebuild
            // below. See checkpoint.ts:715 for the matching gate.
            if (lastUser.agentID && lastUser.agentID !== "main") {
              yield* compaction
                .create({
                  sessionID,
                  agent: lastUser.agent,
                  model: { providerID: model.providerID, modelID: model.id },
                  auto: true,
                  agentID: lastUser.agentID,
                })
                .pipe(Effect.ignore)
              // After inserting the boundary, the actor's filterCompactedEffect
              // slice begins at the boundary marker — context is freed for the
              // next iteration's stream. Skip the next overflow check so the
              // model can respond on the trimmed context.
              skipOverflowCheck = true
              continue
            }

            const rebuilt =
              cfg.compaction?.strategy !== "legacy" && (yield* prune.maxThresholdCrossed(sessionID))
                ? yield* Effect.gen(function* () {
                    const boundary = yield* checkpoint.lastBoundary(sessionID)
                    if (!boundary) return false
                    const didInsert = yield* checkpoint.insertRebuildBoundary({
                      sessionID,
                      boundary,
                      agentID: lastUser.agentID,
                      agent: lastUser.agent,
                      model: { providerID: model.providerID, modelID: model.id },
                      boundaryCreatedAt: msgs.find((message) => message.info.id === boundary)?.info.time.created,
                    })
                    return didInsert
                  }).pipe(Effect.catch(() => Effect.succeed(false)))
                : false
            if (rebuilt) {
              yield* prune.resetThresholds(sessionID)
              skipOverflowCheck = true
              continue
            }

            yield* compaction
              .create({
                sessionID,
                agent: lastUser.agent,
                model: { providerID: model.providerID, modelID: model.id },
                auto: true,
                overflow: overflowed,
                agentID: lastUser.agentID,
              })
              .pipe(Effect.ignore)
            skipOverflowCheck = true
            continue
          }
          skipOverflowCheck = false

          // `agent` resolved at iteration start; reuse here for the
          // agent-not-found user-visible error.
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* insertReminders({ messages: msgs, agent, session })

          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            agentID: lastUser.agentID,
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)
          const handle = yield* processor.create({
            assistantMessage: msg,
            sessionID,
            model,
            submitAt: lastUser.time.created,
            agentMetrics,
            manageSessionStatus: false,
          })

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            if (step === 1 && !isUserHiddenSystemActorID(lastUser.agentID))
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              mergeSteerFollowups(msgs, lastFinished, pendingSteerIDs)
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                if (hasSteerMarker(m)) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            if (agent?.name !== "context-reviewer") {
              yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
            }

            const format = lastUser.format ?? { type: "text" as const }
            const contextReviewEnabled = (yield* config.getGlobal()).context_review?.enabled ?? true
            if (step === 1 && agentID === "main" && !contextReviewEnabled) {
              // A disabled reviewer must not leave an old hand-off available to
              // a later re-enable. Reviews are intentionally one-turn advice.
              yield* contextReview.expire({ sessionID })
            }
            const currentUser = msgs.findLast((message) => message.info.id === lastUser.id)
            if (step === 1 && agentID === "main" && contextReviewEnabled && currentUser && isReviewableMainUser(currentUser)) {
              const previousUser = msgs
                .filter(
                  (message) =>
                    message.info.role === "user" &&
                    message.info.id < lastUser.id &&
                    isReviewableMainUser(message),
                )
                .at(-1)
              if (previousUser && isReviewableMainUser(previousUser)) {
                const claimedReview = yield* contextReview.claimForNextUser({
                  sessionID,
                  sourceUserMessageID: previousUser.info.id,
                  consumingUserMessageID: lastUser.id,
                })
                if (claimedReview?.findings) {
                  const availableSkills = new Set(
                    (yield* skill.available(
                      agent,
                      Permission.merge(agent.permission, session.permission ?? [], options?.permission ?? []),
                    )).map((item) => item.name),
                  )
                  reviewHandoff = {
                    ...claimedReview,
                    findings: {
                      ...claimedReview.findings,
                      // Review output is untrusted structured model output. A
                      // hand-off may mention a Skill that was removed, hidden,
                      // or denied after the review ran; never expose it to the
                      // next turn as a mandatory action.
                      skills: claimedReview.findings.skills.filter((item) => availableSkills.has(item.name)),
                    },
                  }
                }
              }
            }
            const loadActiveTools = resolveTools({
              agent,
              session,
              model,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              nativeWebSearchBlocked: nativeWebSearchFallbacks > 0,
              messages: msgs,
              contextReviewMemory: (reviewHandoff?.findings?.memory.length ?? 0) > 0,
              agentID: lastUser.agentID,
              task_id,
              permission: options?.permission,
              interactive: options?.interactive,
              onPermissionRequest: options?.onPermissionRequest,
              onQuestionRequest: options?.onQuestionRequest,
            }).pipe(
              Effect.tap((tools) =>
                Effect.sync(() => {
                  if (format.type !== "json_schema") return
                  tools["StructuredOutput"] = createStructuredOutputTool({
                    schema: format.schema,
                    onSuccess(output) {
                      structured = output
                    },
                  })
                }),
              ),
            )

            // Determine if this iteration is for a fork agent (contextMode === "full").
            // Fork agents use the frozen ForkContext snapshot captured at spawn time
            // (system + inheritedMessages) rather than recomputing from their own
            // agent identity — which would diverge from the parent and break the
            // prefix cache.
            const actorRecord = lastUser.agentID
              ? yield* actorRegistry.get(sessionID, lastUser.agentID).pipe(Effect.orElseSucceed(() => undefined))
              : undefined
            // v9 registers main as `mode: "main"` with `contextMode: "full"`.
            // Only spawned actors (subagent/peer) carry a frozen ForkContext;
            // main is the captor, never the captured.
            const isForkAgent =
              actorRecord?.contextMode === "full" && (actorRecord.mode === "subagent" || actorRecord.mode === "peer")

            // Fork path: read frozen ForkContext from Actor service (late-bound via
            // spawnRef to break the Actor → SessionPrompt → Actor layer cycle).
            // If forkCtx is missing (race / cleanup bug / spawn skipped), fail the
            // actor so the next prune turn can spawn a fresh fork.
            if (isForkAgent) {
              const tools = yield* loadActiveTools
              const forkCtxEffect = spawnRef.current?.getForkContext(lastUser.agentID!)
              const forkCtx = forkCtxEffect ? yield* forkCtxEffect : undefined
              if (!forkCtx) {
                yield* slog.warn("fork agent runLoop: missing forkContext, failing actor", {
                  sessionID,
                  agentID: lastUser.agentID,
                })
                yield* actorRegistry
                  .updateStatus(sessionID, lastUser.agentID!, {
                    status: "idle",
                    lastOutcome: "failure",
                    lastError: "missing fork context",
                  })
                  .pipe(Effect.ignore)
                return "break" as const
              }
              const ownNew = msgs.filter(
                (m) => m.info.id > forkCtx.watermarkMsgID && m.info.agentID === lastUser.agentID,
              )
              const ownNewModelMsgs = yield* MessageV2.toModelMessagesEffect(ownNew, model)
              const prebuiltSystem = forkCtx.system
              const modelMsgs: ModelMessage[] = [...forkCtx.inheritedMessages, ...ownNewModelMsgs]
              // additions is empty for fork agents: system is taken verbatim from
              // forkCtx.system. Passed as `system` to handle.process for logging/replay.
              const additions: string[] = []
              // Note: fork uses `tools` from resolveTools (not `forkCtx.tools`) — runtime
              // tool dispatch needs execute closures, which `forkCtx.tools` does not carry.
              // Schema parity with parent is currently a consequence of checkpoint-writer
              // having no toolAllowlist (Task 2.6 + agent.test.ts guard). See ForkContext.tools
              // JSDoc in packages/lfcode/src/actor/spawn.ts for the full contract.
              const result = yield* handle.process({
                user: lastUser,
                agent,
                submitAt: lastUser.time.created,
                // Fork inherits the parent agent's permission (captured at spawn into
                // ForkContext). This drives llm.ts resolveTools/disabled() to the SAME
                // visible tool set as the parent → prompt-cache parity on the inherited
                // prefix. Scope: this affects tool VISIBILITY only; the per-call ask
                // ruleset (built separately in resolveTools' ask closure) is unchanged.
                // Parity is exact modulo non-default `session.permission`: the parent's
                // visibility ruleset is merge(parent.permission, session.permission)
                // while the fork's is merge(writer.permission, parentPermission) — so a
                // session-level rule pins the parent but not the fork. Still a strict
                // improvement over the old bespoke "*":"deny" block (which always
                // diverged). The `?? session.permission` is defense-in-depth only:
                // parentPermission is a required field (empty `[]` on a missed capture,
                // which `??` does NOT override), so the fallback fires solely if a future
                // refactor makes the field optional.
                permission: forkCtx.parentPermission ?? session.permission,
                sessionID,
                parentSessionID: session.parentID,
                system: additions,
                prebuiltSystem,
                messages: [...insertTavernContext(modelMsgs, lastUser.tavernContext), ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
                tools,
                model,
              toolChoice:
                format.type === "json_schema" && ProviderTransform.supportsRequiredToolChoice(model)
                  ? "required"
                  : format.type === "json_schema"
                    ? "auto"
                    : undefined,
              agentID: lastUser.agentID,
              abortSignal,
            })

              if (abortSignal?.aborted) {
                yield* writeAbortedError(handle.message)
                return "break" as const
              }

              if (result === "continue" && (yield* autoContinueOutputLength({ lastUser, assistant: handle.message }))) {
                return "continue" as const
              }

              if (structured !== undefined) {
                handle.message.structured = structured
                handle.message.finish = handle.message.finish ?? "stop"
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }

              const forkParts = MessageV2.parts(handle.message.id)
              const forkClassification = classifyAssistantStep({
                phase: "after-process",
                lastUser,
                assistant: handle.message,
                parts: forkParts,
                processResult: result,
              })
              if (forkClassification.type === "filtered") {
                yield* writeContentFilterError({ assistant: handle.message })
                return "break" as const
              }
              const forkBudgetReset = resetContinuationBudgets(handle.message, forkParts)
              if (forkBudgetReset) yield* slog.info("reset continuation budgets after usable progress", forkBudgetReset)
              if (forkClassification.type === "failed") {
                if (
                  yield* autoContinueInterruptedOutput({
                    lastUser,
                    assistant: handle.message,
                    parts: forkParts,
                  })
                )
                  return "continue" as const
                yield* writeModelError({ assistant: handle.message, reason: forkClassification.reason })
                return "break" as const
              }
              if (forkClassification.type !== "continue" && !handle.message.error && format.type === "json_schema") {
                if (yield* autoRetryStructuredOutput({ lastUser, assistant: handle.message }))
                  return "continue" as const
                return "break" as const
              }

              if (
                (forkClassification.type === "think-only" || forkClassification.type === "invalid") &&
                format.type !== "json_schema"
              ) {
                const reason = forkClassification.type === "invalid" ? forkClassification.reason : "think-only"
                if (yield* autoContinueInvalidOutput({ lastUser, assistant: handle.message, reason }))
                  return "continue" as const
                return "break" as const
              }

              if (forkClassification.type === "final" && forkClassification.degraded)
                yield* slog.warn("degraded final on abnormal finish", { finish: handle.message.finish })
              if (result === "stop") return "break" as const
              // Fork agents are always subagents (lastUser.agentID is set); use
              // per-actor compaction on overflow (same as non-fork subagent path).
              if (!isBoundedComputation && result === "overflow") {
                yield* compaction
                  .create({
                    sessionID,
                    agent: lastUser.agent,
                    model: { providerID: model.providerID, modelID: model.id },
                    auto: true,
                    overflow: true,
                    agentID: lastUser.agentID,
                  })
                  .pipe(Effect.ignore)
              }
              return "continue" as const
            }

            const loadSystemInputs = Effect.gen(function* () {
              const loadSystemInputsAt = Date.now()
              yield* slog.info("loadSystemInputs", {
                status: "started",
                sessionID,
                step,
                agent: agent.name,
              })
              if (isTavernSession(session)) {
                return { skills: undefined, env: [], instructions: { content: [], paths: new Set<string>() } }
              }
              const [skills, env, instructions] = yield* Effect.all([
                sys.skills(agent),
                Effect.sync(() => sys.environment(model)),
                instruction.system().pipe(Effect.orDie),
              ])
              yield* slog.info("loadSystemInputs", {
                status: "completed",
                duration: Date.now() - loadSystemInputsAt,
                sessionID,
                step,
                agent: agent.name,
              })
              return { skills, env, instructions }
            })
            const [tools, systemInputs] = yield* Effect.all([loadActiveTools, loadSystemInputs], {
              concurrency: 2,
            })
            const { skills, env, instructions } = systemInputs
            // Surface which instruction files (CLAUDE.md, AGENTS.md, ...) were loaded.
            // Only for primary sessions (subagents would be noisy) and once per session.
            if (!session.parentID && !instructionsNotified.has(sessionID)) {
              instructionsNotified.add(sessionID)
              const worktree = (yield* InstanceState.context).worktree
              const files = Array.from(instructions.paths, (p) => Instruction.display(p, worktree))
              if (files.length > 0) {
                yield* bus.publish(TuiEvent.InstructionsLoaded, { files }).pipe(Effect.ignore)
              }
            }
            const additions = [
              ...env,
              ...(skills ? [skills] : []),
              ...(reviewHandoff ? [formatContextReview(reviewHandoff)].filter((item): item is string => Boolean(item)) : []),
              ...instructions.content,
              ...(format.type === "json_schema" ? [STRUCTURED_OUTPUT_SYSTEM_PROMPT] : []),
            ]
            // Note: `buildLLMRequestPrefix` also returns a `tools` field, but we
            // intentionally don't use it here — the `tools` variable from `resolveTools`
            // (set earlier via `handle.process({tools: ...})`) carries `execute` closures
            // the AI SDK needs for runtime tool dispatch, while `buildLLMRequestPrefix`
            // produces schema-only tools. Schema bytes match between both paths (both call
            // registry.tools with identical args), so prefix cache parity holds.
            // Main runLoop: no watermark — LLM must see the full msgs list,
            // including this turn's intermediate assistant turns (tool reads,
            // task creates, etc.) so each step doesn't replay from the bare
            // user prompt. The watermark is for fork capture only (frozen
            // snapshot of parent-view at spawn time).
            const buildLLMRequestPrefixAt = Date.now()
            yield* slog.info("buildLLMRequestPrefix", {
              status: "started",
              sessionID,
              step,
              agent: agent.name,
            })
            const contextCfg = yield* config.get()
            const activeContext = MessageV2.projectActiveContext(msgs, {
              tailTurns: contextCfg.compaction?.tail_turns,
              maxTailTokens: Math.min(64_000, Math.max(4_000, Math.floor(usable({ cfg: contextCfg, model }) * 0.35))),
            })
            const { system: prebuiltSystem, inheritedMessages: modelMsgs } = yield* buildLLMRequestPrefix({
              sessionID,
              agent,
              model,
              msgs: activeContext.messages,
              permission: Permission.merge(agent.permission, session.permission ?? [], options?.permission ?? []),
              includeSkills: !isTavernSession(session),
              additions,
              includeTools: !isTavernSession(session),
            }).pipe(
              Effect.provideService(LLM.Service, llm),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(Skill.Service, skill),
            )

            // The assistant usage field only reflects the previous provider turn.
            // Admit the actual request envelope as well, because large tool schemas,
            // system instructions, or the current user message can overflow before
            // the next assistant usage is available.
            const requestTokens = estimateRequestTokens({
              system: prebuiltSystem,
              messages: modelMsgs,
              tools,
            })
            const requestLimit = usable({ cfg: contextCfg, model })
            if (!skipOverflowCheck && !isBoundedComputation && requestLimit > 0 && requestTokens >= requestLimit) {
              yield* slog.warn("request admission triggered compaction", {
                sessionID,
                step,
                requestTokens,
                requestLimit,
                toolCount: Object.keys(tools).length,
              })
              yield* compaction
                .create({
                  sessionID,
                  agent: lastUser.agent,
                  model: { providerID: model.providerID, modelID: model.id },
                  auto: true,
                  overflow: true,
                  agentID: lastUser.agentID,
                })
                .pipe(Effect.ignore)
              handle.message.finish = "stop"
              handle.message.time.completed = Date.now()
              yield* sessions.updateMessage(handle.message)
              skipOverflowCheck = true
              return "continue" as const
            }
            yield* slog.info("buildLLMRequestPrefix", {
              status: "completed",
              duration: Date.now() - buildLLMRequestPrefixAt,
              sessionID,
              step,
              agent: agent.name,
              activeContext: activeContext.stats,
            })
            const maxModeCfg = (yield* config.get()).experimental?.maxMode
            const useMaxMode =
              agent.name === MaxMode.MAX_MODE_AGENT && maxModeCfg !== undefined && format.type !== "json_schema"

            const processArgs = {
              user: lastUser,
              agent,
              permission: Permission.merge(session.permission ?? [], options?.permission ?? []),
              sessionID,
              parentSessionID: session.parentID,
              submitAt: lastUser.time.created,
              // system: additions is preserved for non-LLM consumers of StreamInput (e.g.,
              // MessageV2.User.system for logging/replay); llm.stream itself uses prebuiltSystem.
              system: additions,
              prebuiltSystem,
              messages: [...insertTavernContext(modelMsgs, lastUser.tavernContext), ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              toolChoice:
                format.type === "json_schema" && ProviderTransform.supportsRequiredToolChoice(model)
                  ? ("required" as const)
                  : format.type === "json_schema"
                    ? ("auto" as const)
                    : undefined,
              agentID: lastUser.agentID,
              abortSignal,
            }

            const llmProcessAt = Date.now()
            yield* slog.info("llmProcess", {
              status: "started",
              sessionID,
              step,
              agent: agent.name,
              toolCount: Object.keys(tools).length,
            })
            const result = useMaxMode
              ? yield* MaxMode.runMaxStep({
                  // runMaxStep reuses the identical per-step args as handle.process
                  // and selects a single candidate before continuing the session.
                  ...processArgs,
                  handle,
                  llm,
                  candidates: maxModeCfg?.candidates,
                  setStatus: () => Effect.void,
                })
              : yield* handle.process(processArgs)
            yield* slog.info("llmProcess", {
              status: "completed",
              duration: Date.now() - llmProcessAt,
              sessionID,
              step,
              agent: agent.name,
              toolCount: Object.keys(tools).length,
            })
            if (abortSignal?.aborted) {
              yield* writeAbortedError(handle.message)
              return "break" as const
            }

            if (result === "continue" && (yield* autoContinueOutputLength({ lastUser, assistant: handle.message }))) {
              return "continue" as const
            }

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const parts = MessageV2.parts(handle.message.id)
            const classification = classifyAssistantStep({
              phase: "after-process",
              lastUser,
              assistant: handle.message,
              parts,
              processResult: result,
            })
            if (classification.type === "filtered") {
              yield* writeContentFilterError({ assistant: handle.message })
              return "break" as const
            }
            const budgetReset = resetContinuationBudgets(handle.message, parts)
            if (budgetReset) yield* slog.info("reset continuation budgets after usable progress", budgetReset)
            if (classification.type === "failed") {
              if (
                yield* autoContinueInterruptedOutput({
                  lastUser,
                  assistant: handle.message,
                  parts,
                })
              )
                return "continue" as const
              yield* writeModelError({ assistant: handle.message, reason: classification.reason })
              return "break" as const
            }
            if (classification.type !== "continue" && !handle.message.error && format.type === "json_schema") {
              if (yield* autoRetryStructuredOutput({ lastUser, assistant: handle.message })) return "continue" as const
              return "break" as const
            }

            if (
              (classification.type === "think-only" || classification.type === "invalid") &&
              format.type !== "json_schema"
            ) {
              const reason = classification.type === "invalid" ? classification.reason : "think-only"
              if (yield* autoContinueInvalidOutput({ lastUser, assistant: handle.message, reason }))
                return "continue" as const
              return "break" as const
            }

            if (classification.type === "final" && classification.degraded)
              yield* slog.warn("degraded final on abnormal finish", { finish: handle.message.finish })
            if (result === "stop") return "break" as const
            if (!isBoundedComputation && result === "overflow") {
              // Subagent overflow → per-actor compaction. Insert a boundary
              // tagged with the subagent's agent_id; the next runLoop iteration
              // will see a trimmed context (filterCompactedEffect stops at
              // the boundary).
              // Gate must exclude "main" — see comment at the matching gate
              // earlier in this file (~line 1716) and at checkpoint.ts:715.
              if (lastUser.agentID && lastUser.agentID !== "main") {
                yield* compaction
                  .create({
                    sessionID,
                    agent: lastUser.agent,
                    model: { providerID: model.providerID, modelID: model.id },
                    auto: true,
                    overflow: true,
                    agentID: lastUser.agentID,
                  })
                  .pipe(Effect.ignore)
                return "continue" as const
              }

              yield* compaction
                .create({
                  sessionID,
                  agent: lastUser.agent,
                  model: { providerID: model.providerID, modelID: model.id },
                  auto: true,
                  overflow: true,
                  agentID: lastUser.agentID,
                })
                .pipe(Effect.ignore)
            }
            return "continue" as const
          }).pipe(Effect.ensuring(instruction.clear(handle.message.id)))
          if (outcome === "break") {
            if ((!agentID || agentID === "main") && (yield* state.hasPendingSteer(sessionID))) continue
            if (yield* goalGate(lastUser)) continue
            break
          }
          continue
        }

        const promptOps = yield* ops()
        if (lastModelForPrune && lastFinishedForPrune && !isUserHiddenSystemActorID(lastFinishedForPrune.agentID)) {
          yield* prune
            .prune({
              sessionID,
              model: lastModelForPrune,
              tokens: lastFinishedForPrune.tokens,
              lastAssistantTime: lastFinishedForPrune.time.completed,
              promptOps,
            })
            .pipe(Effect.ignore, Effect.forkIn(scope))
        }
        const final = yield* lastAssistant(sessionID, agentID)
        const finalIsError = final.info.role === "assistant" && !!final.info.error
        const lastUserForMetrics = yield* sessions.findMessage(sessionID, (m) => m.info.role === "user", {
          agentID: "*",
        })
        if (
          agentID === "main" &&
          !session.parentID &&
          !isTavernSession(session) &&
          !finalIsError &&
          lastModelForPrune &&
          reviewSource?.info.role === "user"
        ) {
          const reviewAgent = yield* agents.get(reviewSource.info.agent)
          const primarySnapshot = yield* MessageV2.filterCompactedEffect(sessionID, {
            contextFrom: session.contextFrom,
            contextWatermark: session.contextWatermark,
            agentID: "main",
          })
          const watermark = primarySnapshot.findIndex((message) => message.info.id === final.info.id)
          if (reviewAgent && watermark >= 0) {
            yield* scheduleContextReview({
              sessionID,
              user: reviewSource.info,
              assistant: final.info as MessageV2.Assistant,
              agent: reviewAgent,
              model: lastModelForPrune,
              permission: Permission.merge(reviewAgent.permission, session.permission ?? [], options?.permission ?? []),
              messages: primarySnapshot.slice(0, watermark + 1),
            }).pipe(Effect.ignore, Effect.forkIn(scope))
          }
        }
        if (!isUserHiddenSystemActorID(final.info.agentID)) {
          yield* publishAgentRequest(
            finalIsError ? "error" : "completed",
            Option.isSome(lastUserForMetrics) ? lastUserForMetrics.value.info.agent : final.info.agent,
          )
        }
        return final
    })

    const loop: (
      input: z.infer<typeof LoopInput> & Omit<PromptRunOptions, "abortSignal">,
      abortSignal?: AbortSignal,
    ) => Effect.Effect<MessageV2.WithParts> = Effect.fn(
      "SessionPrompt.loop",
    )(function* (input: z.infer<typeof LoopInput> & Omit<PromptRunOptions, "abortSignal">, abortSignal?: AbortSignal) {
      const agentID = input.agentID ?? "main"
      return yield* state.ensureRunning(
        input.sessionID,
        agentID,
        interruptedAssistant(input.sessionID, agentID),
        (signal) =>
          runLoop(input.sessionID, agentID, input.task_id, signal, {
            permission: input.permission,
            interactive: input.interactive,
            onPermissionRequest: input.onPermissionRequest,
            onQuestionRequest: input.onQuestionRequest,
          }),
        abortSignal,
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.shell")(
      function* (input: ShellInput) {
        return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input))
      },
    )

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = Command.unknownCommandHints(yield* commands.list())
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent ?? (yield* agents.defaultAgent())

      // /goal — set or clear a session-level stop-condition goal. The condition
      // text itself becomes the prompt for this turn (the working agent starts
      // pursuing it immediately); the main runLoop then refuses to stop until
      // the judge says it's satisfied. See session/goal.ts.
      if (input.command === Command.Default.GOAL) {
        const condition = input.arguments.trim()
        if (condition === "" || condition === "clear" || condition === "reset") {
          yield* goal.clear(input.sessionID)
          return yield* prompt({
            sessionID: input.sessionID,
            messageID: input.messageID,
            agent: agentName,
            parts: [{ type: "text", text: "Goal cleared.", synthetic: true }],
            noReply: true,
          })
        }
        if (condition === "pause") {
          yield* goal.pause(input.sessionID)
          return yield* prompt({
            sessionID: input.sessionID,
            messageID: input.messageID,
            agent: agentName,
            parts: [{ type: "text", text: "Goal paused.", synthetic: true }],
            noReply: true,
          })
        }
        if (condition === "resume") {
          yield* goal.resume(input.sessionID)
          return yield* prompt({
            sessionID: input.sessionID,
            messageID: input.messageID,
            agent: agentName,
            parts: [{ type: "text", text: "Goal resumed.", synthetic: true }],
            noReply: true,
          })
        }
        if (condition === "delete") {
          yield* goal.delete(input.sessionID)
          return yield* prompt({
            sessionID: input.sessionID,
            messageID: input.messageID,
            agent: agentName,
            parts: [{ type: "text", text: "Goal deleted.", synthetic: true }],
            noReply: true,
          })
        }
        yield* goal.set(input.sessionID, condition)
      }

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      // Skill bodies are not read until the current session/agent rules have
      // allowed the exact name below. This also avoids retaining a stale body
      // from a command lookup across Skill.refresh().
      let templateCommand = cmd.source === "skill" ? "" : yield* Effect.promise(async () => cmd.template)

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* lastModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID, input.agent)

      const agent = yield* agents.get(agentName)
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      if (cmd.source === "skill") {
        const session = yield* sessions.get(input.sessionID)
        const allowed = yield* skill.available(
          agent,
          Permission.merge(agent.permission, session.permission ?? []),
        )
        const current = allowed.find((item) => item.name === input.command)
        if (!current) {
          // Do not distinguish a deleted Skill from one denied by the current
          // session/agent rules. Slash commands must not disclose either its
          // metadata or retained body after access is revoked.
          const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".` })
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }
        templateCommand = current.content
      }

      let template: string
      if (cmd.source === "skill") {
        template = input.arguments
      } else {
        const placeholders = templateCommand.match(placeholderRegex) ?? []
        let last = 0
        for (const item of placeholders) {
          const value = Number(item.slice(1))
          if (value > last) last = value
        }

        const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
          const position = Number(index)
          const argIndex = position - 1
          if (argIndex >= args.length) return ""
          if (position === last) return args.slice(argIndex).join(" ")
          return args[argIndex]
        })
        const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
        template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

        if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
          template = template + "\n\n" + input.arguments
        }
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const sh = Shell.preferred()
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const subtaskContext =
        agent.defaultContext === "full" ? "full" : agent.defaultContext === "task" ? "none" : "state"
      const subtaskRefs = templateParts.flatMap((part) => {
        if (part.type !== "file") return []
        if (part.source?.type === "resource") return [part.source.uri]
        if (part.source?.type === "file" || part.source?.type === "symbol") return [part.source.path]
        return []
      })

      let parts: PromptInput["parts"]
      if (isSubtask) {
        const promptText =
          cmd.source === "skill"
            ? templateCommand + (input.arguments.trim() ? "\n\n" + input.arguments : "")
            : (templateParts.find((y): y is typeof y & { type: "text"; text: string } => y.type === "text")?.text ?? "")
        parts = [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: cmd.description ?? "",
            command: input.command,
            model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
            prompt: promptText,
            execution: agent.defaultExecution ?? "wait",
            context: subtaskContext,
            contextRefs: [...new Set(subtaskRefs)],
            declaredFiles: [...new Set(subtaskRefs.filter((ref) => !ref.includes("://")))],
            ...(input.command === "deep-research"
              ? {
                  research: ResearchDispatchSnapshot.parse({
                    kind: "deep-research",
                    ...(input.arguments.trim()
                      ? { title: input.arguments.replace(/\s+/g, " ").trim().slice(0, 240) }
                      : {}),
                    depth: /(?:\bdeep\b|深入|深度|全面|详尽)/i.test(input.arguments)
                      ? "deep"
                      : /(?:\bquick\b|快速|简要|速查)/i.test(input.arguments)
                        ? "quick"
                        : "standard",
                    phase: "planning",
                  }),
                }
              : {}),
          },
        ]
      } else if (cmd.source === "skill") {
        const visibleText = input.arguments.trim() ? `/${input.command} ${input.arguments}` : `/${input.command}`
        const skillPart = {
          type: "text" as const,
          text: `<skill_content name="${input.command}">\n${templateCommand}\n</skill_content>`,
          synthetic: true,
        }
        const attachments = templateParts.filter((p): p is Exclude<typeof p, { type: "text" }> => p.type !== "text")
        parts = [{ type: "text" as const, text: visibleText }, skillPart, ...attachments, ...(input.parts ?? [])]
      } else {
        parts = [...templateParts, ...(input.parts ?? [])]
      }

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultAgent())) : agentName
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* lastModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    const impl = Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
      sweepOrphanAssistants,
      predict,
    })
    sessionPromptRef.current = { loop: impl.loop }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (sessionPromptRef.current?.loop === impl.loop) sessionPromptRef.current = undefined
      }),
    )
    return impl
  }),
).pipe(Layer.provide(ContextReview.layer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionPrune.defaultLayer),
    Layer.provide(SessionCheckpoint.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Config.defaultLayer,
        SessionSummary.defaultLayer,
        Team.defaultLayer,
        ActorRegistry.defaultLayer,
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
        Inbox.defaultLayer,
        Goal.defaultLayer,
      ),
    ),
  ),
)
export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  modelRef: z
    .string()
    .optional()
    .describe(
      "Model group/tier name (e.g. ultra/standard/lite) or a literal provider/model. Resolved provider-aware. Takes precedence over `model` when both are set.",
    ),
  agent: z.string().optional(),
  agentID: z.string().optional(),
  task_id: z
    .string()
    .optional()
    .describe(
      "If the spawning caller bound this prompt to a specific user-task (T4 etc), pass its TID. Propagates to Tool.Context.taskId so memory-path-guard allows writes to tasks/<task_id>/*.md.",
    ),
  source: z.enum(["user", "spawn", "hook", "automation"]).optional(),
  provenance: MessageV2.Provenance.optional(),
  noReply: z.boolean().optional(),
  tools: z
    .record(z.string(), z.boolean())
    .optional()
    .describe("@deprecated tools and permissions have been merged, you can set permissions on the session itself now"),
  format: MessageV2.Format.optional(),
  system: z.string().optional(),
  tavernContext: MessageV2.TavernContext.optional(),
  variant: z.string().optional(),
  delivery: z.enum(["default", "steer"]).optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      MessageV2.TextPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "TextPartInput",
        }),
      MessageV2.FilePart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "FilePartInput",
        }),
      MessageV2.AgentPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "AgentPartInput",
        }),
      MessageV2.SubtaskPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "SubtaskPartInput",
        }),
    ]),
  ),
})
export type PromptInput = z.infer<typeof PromptInput>

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  agentID: z.string().optional(),
  task_id: z.string().optional(),
})

export const ShellInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  agent: z.string(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  modelRef: z
    .string()
    .optional()
    .describe(
      "Model group/tier name (e.g. ultra/standard/lite) or a literal provider/model. Resolved provider-aware. Takes precedence over `model` when both are set.",
    ),
  command: z.string(),
})
export type ShellInput = z.infer<typeof ShellInput>

export const CommandInput = z.object({
  messageID: MessageID.zod.optional(),
  sessionID: SessionID.zod,
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        }).partial({
          id: true,
        }),
      ]),
    )
    .optional(),
})
export type CommandInput = z.infer<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}

function hasUsableAssistantProgress(assistant: MessageV2.Assistant, parts: MessageV2.Part[]) {
  if (assistant.summary || assistant.structured !== undefined) return false
  return parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") return !!part.text.trim()
    if (part.type !== "tool") return false
    return part.state.status === "completed"
  })
}

function isInterruptedStreamAssistant(assistant: MessageV2.Assistant, parts: MessageV2.Part[]) {
  if (assistant.error?.name !== "ModelError" && assistant.error?.name !== "MessageAbortedError") return false
  if (assistant.summary || assistant.structured !== undefined) return false
  const stepFinish = [...parts].reverse().find((part): part is MessageV2.StepFinishPart => part.type === "step-finish")
  if (stepFinish?.reason === "missing-finish-step") return true
  return hasUsableAssistantProgress(assistant, parts)
}

function isTavernSession(session: Pick<Session.Info, "extension">) {
  return session.extension?.pluginID === "lfcode-tavern" && session.extension.type === "tavern"
}

const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"
