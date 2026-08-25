import { Provider } from "@/provider"
import { Log } from "@/util"
import { Context, Duration, Effect, Layer, Record, Schedule, Ref } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep, pipe } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import * as ProviderTransform from "@/provider/transform"
import { Config } from "@/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util"
import { SessionID } from "@/session/schema"
import * as Session from "@/session/session"
import { Auth } from "@/auth"
import { InstallationVersion } from "@/installation/version"
import { EffectBridge } from "@/effect"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { ActorRegistry } from "@/actor/registry"
import { Memory } from "@/memory"
import { isRetryableTransientError } from "./retry"
import { describeUnavailableTool, findAvailableToolByNormalizedName, repairToolCallAlias } from "./tool-call-repair"
import { isUserHiddenSystemActorID } from "@/actor/visibility"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>

export async function* gateProviderStreamChunks<A>(stream: AsyncIterable<A>, abortSignal: AbortSignal) {
  for await (const chunk of stream) {
    if (abortSignal.aborted) return
    yield chunk
  }
}

export async function* normalizeTextLifecycle(stream: AsyncIterable<Event>) {
  let textID: string | undefined
  for await (const event of stream) {
    if (event.type === "text-start") {
      textID = event.id
      yield event
      continue
    }
    if (event.type === "text-delta" && !textID) {
      textID = event.id ?? "implicit-text"
      yield {
        type: "text-start",
        id: textID,
        providerMetadata: event.providerMetadata,
      } as Event
    }
    if (event.type === "text-end") textID = undefined
    if (event.type === "finish-step" && textID) {
      yield { type: "text-end", id: textID } as Event
      textID = undefined
    }
    yield event
  }
}

/**
 * Match transient errors that the PERSISTENT_RETRY layer should retry.
 *
 * - HTTP 429 / 5xx / 529 — capacity / overload responses
 * - ECONNRESET / EPIPE / ETIMEDOUT — network errors typically caused by
 *   stale keep-alive sockets or upstream proxy timeouts
 * - "SSE read timed out" — `provider.ts:wrapSSE` chunk-timeout fired
 *   (configured per-provider via `chunkTimeout` in lfcode.json). This
 *   is HTTP-byte-level: keep-alive comments still count as activity, so
 *   the error only fires when the underlying TCP stream is genuinely dead.
 *
 * Auth errors (401/403), client errors (400, 404, 422), and user-
 * initiated aborts are NOT retryable.
 *
 * @deprecated Use `isRetryableTransientError` from `./retry` directly.
 * Kept as a 1-line wrapper to preserve the existing export name.
 */
export function isTransientCapacityError(error: unknown): boolean {
  return isRetryableTransientError(error)
}

/**
 * Persistent-retry schedule with exponential backoff.
 *
 * Exponential backoff 500ms × 2 (i.e. 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256s),
 * each individual delay capped at 5 minutes, total attempts capped at 10.
 *
 * Worst-case total = 11 attempts × chunkTimeout + cumulative backoff
 *                  ≈ 11 × 8min + 9min ≈ 97 min (with DEFAULT_CHUNK_TIMEOUT = 8min).
 *
 * Intentionally NOT capped via Schedule.upTo() — retry persistence under
 * brief upstream outages is the design goal. Bounding per-attempt latency
 * via chunkTimeout is the primary lever for hang-time control.
 */
export const persistentRetrySchedule = Schedule.exponential("500 millis", 2).pipe(
  Schedule.modifyDelay((_, delay) =>
    Effect.succeed(Duration.isLessThanOrEqualTo(delay, Duration.minutes(5)) ? delay : Duration.minutes(5)),
  ),
  Schedule.both(Schedule.recurs(10)),
)

/**
 * Saved-context policy appended to interactive agent prompts. It deliberately
 * contains no memory locations or recovery workflow, so it cannot turn saved
 * context into an automatic preflight step.
 */
function buildMemoryInstructions(): string {
  return `# Saved context

The memory tool is opt-in. Do not search, read, or mention saved memory unless the current user explicitly asks to search, recall, or inspect it. Do not use memory to start, resume, plan, debug, or verify ordinary work; use the active conversation, repository, runtime state, and direct evidence instead.`
}

export function repairToolInputJSON(input: string) {
  const candidates = [input, unwrapJsonFence(input)]
    .flatMap((text) => {
      const trimmed = text.trim()
      const balanced = extractBalancedJson(trimmed)
      return balanced && balanced !== trimmed ? [trimmed, balanced] : [trimmed]
    })
    .filter((text, index, list) => text.length > 0 && list.indexOf(text) === index)

  for (const candidate of candidates) {
    const parsed = parseToolInputCandidate(candidate)
    if (parsed === undefined) continue
    return JSON.stringify(parsed)
  }

  return undefined
}

function parseToolInputCandidate(input: string) {
  const direct = parseStrictJSON(input)
  if (direct !== undefined) return normalizeNestedJSON(direct)

  const jsonc = parseLooseJSON(input)
  if (jsonc !== undefined) return normalizeNestedJSON(jsonc)

  const escaped = escapeInvalidJsonStringContent(input)
  if (escaped === input) return undefined

  const escapedDirect = parseStrictJSON(escaped)
  if (escapedDirect !== undefined) return normalizeNestedJSON(escapedDirect)

  const escapedJsonc = parseLooseJSON(escaped)
  if (escapedJsonc !== undefined) return normalizeNestedJSON(escapedJsonc)

  return undefined
}

function parseStrictJSON(input: string) {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return undefined
  }
}

function parseLooseJSON(input: string) {
  try {
    const errors: ParseError[] = []
    const parsed = parseJsonc(input, errors, { allowTrailingComma: true, disallowComments: false })
    return errors.length === 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

function normalizeNestedJSON(input: unknown): unknown {
  if (typeof input !== "string") return input
  const trimmed = input.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return input
  return parseToolInputCandidate(trimmed) ?? input
}

function unwrapJsonFence(input: string) {
  const trimmed = input.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ?? input
}

function extractBalancedJson(input: string) {
  const start = input[0]
  if (start !== "{" && start !== "[") return undefined

  const stack = [start === "{" ? "}" : "]"]
  let inString = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const prev = i > 0 ? input[i - 1] : undefined
    if (char === '"' && prev !== "\\") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === "{") stack.push("}")
    if (char === "[") stack.push("]")
    if (char === "}" || char === "]") {
      if (stack.at(-1) !== char) return undefined
      stack.pop()
      if (stack.length === 0) return input.slice(0, i + 1)
    }
  }

  return undefined
}

function escapeInvalidJsonStringContent(input: string) {
  let out = ""
  let inString = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    const prev = i > 0 ? input[i - 1] : undefined
    if (char === '"' && prev !== "\\") {
      inString = !inString
      out += char
      continue
    }

    if (!inString) {
      out += char
      continue
    }

    if (char === "\n") {
      out += "\\n"
      continue
    }
    if (char === "\r") {
      out += "\\r"
      continue
    }
    if (char === "\t") {
      out += "\\t"
      continue
    }

    if (char !== "\\") {
      out += char
      continue
    }

    const next = input[i + 1]
    if (!next) {
      out += "\\\\"
      continue
    }

    if ('"\\/bfnrt'.includes(next)) {
      out += char + next
      i++
      continue
    }

    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 2, i + 6))) {
      out += input.slice(i, i + 6)
      i += 5
      continue
    }

    out += "\\\\"
  }

  return out
}

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  submitAt?: number
  abortSignal?: AbortSignal
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  prebuiltSystem?: string[]      // when set, skip buildSystemArray and use this verbatim
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  agentID?: string
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
  readonly buildSystemArray: (input: {
    agent: Agent.Info
    model: Provider.Model
    system: string[]
    user: MessageV2.User
    sessionID: string
    agentID?: string
  }) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  Auth.Service | Config.Service | Provider.Service | Plugin.Service | Permission.Service | ActorRegistry.Service | Memory.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const actorReg = yield* ActorRegistry.Service
    const memory = yield* Memory.Service

    const buildSystemArray = Effect.fn("LLM.buildSystemArray")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      system: string[]
      user: MessageV2.User
      sessionID: string
      agentID?: string
    }) {
      const system: string[] = []
      system.push(
        [
          // use agent prompt otherwise provider prompt
          ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
          // any custom prompt passed into this call
          ...input.system,
          // any custom prompt from last user message
          ...(input.user.system ? [input.user.system] : []),
        ]
          .filter((x) => x)
          .join("\n"),
      )

      // System-maintenance actors do not need the interactive saved-context
      // policy. Normal turns receive only the opt-in constraint below.
      const isSystemActor = input.agentID
        ? yield* actorReg.isSystemSpawned(SessionID.make(input.sessionID), input.agentID)
        : false
      if (!isSystemActor) {
        system.push(buildMemoryInstructions())
      }

      const header = system[0]
      if (!isUserHiddenSystemActorID(input.agentID)) {
        yield* plugin.trigger(
          "experimental.chat.system.transform",
          { sessionID: input.sessionID, model: input.model },
          { system },
        )
      }
      // rejoin to maintain 2-part structure for caching if header unchanged
      if (system.length > 2 && system[0] === header) {
        const rest = system.slice(1)
        system.length = 0
        system.push(header, rest.join("\n"))
      }

      return system
    })

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const userExtensionsEnabled = !isUserHiddenSystemActorID(input.agentID)
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

      const system =
        input.prebuiltSystem ??
        (yield* buildSystemArray({
          agent: input.agent,
          model: input.model,
          system: input.system,
          user: input.user,
          sessionID: input.sessionID,
          agentID: input.agentID,
        }))

      const variant =
        !input.small && input.model.variants && input.user.model.variant
          ? input.model.variants[input.user.model.variant]
          : {}
      const base = input.small
        ? ProviderTransform.smallOptions(input.model)
        : ProviderTransform.options({
            model: input.model,
            sessionID: input.sessionID,
            providerOptions: item.options,
          })
      const options: Record<string, any> = pipe(
        base,
        mergeDeep(input.model.options),
        mergeDeep(input.agent.options),
        mergeDeep(variant),
      )
      if (isOpenaiOauth) {
        options.instructions = system.join("\n")
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const messages = isOpenaiOauth
        ? input.messages
        : isWorkflow
          ? input.messages
          : [
              ...system.map(
                (x): ModelMessage => ({
                  role: "system",
                  content: x,
                }),
              ),
              ...input.messages,
            ]

      const params = userExtensionsEnabled
        ? yield* plugin.trigger(
            "chat.params",
            {
              sessionID: input.sessionID,
              agent: input.agent.name,
              model: input.model,
              provider: item,
              message: input.user,
            },
            {
              temperature: input.model.capabilities.temperature
                ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
                : undefined,
              topP: input.agent.topP ?? ProviderTransform.topP(input.model),
              topK: ProviderTransform.topK(input.model),
              maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
              options,
            },
          )
        : {
            temperature: input.model.capabilities.temperature
              ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
              : undefined,
            topP: input.agent.topP ?? ProviderTransform.topP(input.model),
            topK: ProviderTransform.topK(input.model),
            maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
            options,
          }

      const { headers } = userExtensionsEnabled
        ? yield* plugin.trigger(
            "chat.headers",
            {
              sessionID: input.sessionID,
              agent: input.agent.name,
              model: input.model,
              provider: item,
              message: input.user,
            },
            {
              headers: {},
            },
          )
        : { headers: {} }

      const tools = resolveTools(input)

      // LiteLLM and some Anthropic proxies require the tools parameter to be present
      // when message history contains tool calls, even if no tools are being used.
      // Add a dummy tool that is never called to satisfy this validation.
      // This is enabled for:
      // 1. Providers with "litellm" in their ID or API ID (auto-detected)
      // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
      const isLiteLLMProxy =
        item.options?.["litellmProxy"] === true ||
        input.model.providerID.toLowerCase().includes("litellm") ||
        input.model.api.id.toLowerCase().includes("litellm")

      // LiteLLM/Bedrock rejects requests where the message history contains tool
      // calls but no tools param is present. When there are no active tools (e.g.
      // during compaction), inject a stub tool to satisfy the validation requirement.
      // The stub description explicitly tells the model not to call it.
      if (
        (isLiteLLMProxy || input.model.providerID.includes("github-copilot")) &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools["_noop"] = tool({
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              reason: { type: "string", description: "Unused" },
            },
          }),
          execute: async () => ({ output: "", title: "", metadata: {} }),
        })
      }
      const activeToolNames = Object.keys(tools).filter((x) => x !== "invalid")

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via lfcode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const normalizedTool = findAvailableToolByNormalizedName(activeToolNames, toolName)
          const aliasRepair = repairToolCallAlias({
            requestedToolName: toolName,
            toolInput: argsJson,
            activeTools: activeToolNames,
          })
          const resolvedToolName =
            aliasRepair?.type === "repair" ? aliasRepair.toolName : normalizedTool ?? toolName
          const resolvedInput = aliasRepair?.type === "repair" ? aliasRepair.input : argsJson
          const t = tools[resolvedToolName]
          if (aliasRepair?.type === "unavailable") {
            return { result: "", error: aliasRepair.error }
          }
          if (!t || !t.execute) {
            return { result: "", error: describeUnavailableTool(toolName, activeToolNames) }
          }
          try {
            const result = await t.execute!(JSON.parse(resolvedInput), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = Instance.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      const streamStartTs = Date.now()
      l.debug("streamText starting", {
        messageID: input.user.id,
        msgCount: messages.length,
        toolCount: Object.keys(tools).length,
        submitDelayMs: input.submitAt ? streamStartTs - input.submitAt : undefined,
      })

      const result = streamText({
        onError(error) {
          l.debug("streamText error", {
            messageID: input.user.id,
            error: error instanceof Error ? error.message : String(error),
            elapsedMs: Date.now() - streamStartTs,
          })
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const repairedTool = findAvailableToolByNormalizedName(activeToolNames, failed.toolCall.toolName)
          const repairedInput =
            typeof failed.toolCall.input === "string" ? repairToolInputJSON(failed.toolCall.input) : undefined

          if (repairedInput && repairedTool) {
            l.info("repairing tool call input", {
              tool: failed.toolCall.toolName,
              repaired: repairedTool,
            })
            return {
              ...failed.toolCall,
              toolName: repairedTool,
              input: repairedInput,
            }
          }

          const aliasRepair = repairToolCallAlias({
            requestedToolName: failed.toolCall.toolName,
            toolInput: repairedInput ?? failed.toolCall.input,
            activeTools: activeToolNames,
          })
          if (aliasRepair?.type === "repair") {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: aliasRepair.toolName,
              reason: aliasRepair.reason,
            })
            return {
              ...failed.toolCall,
              toolName: aliasRepair.toolName,
              input: aliasRepair.input,
            }
          }
          if (aliasRepair?.type === "unavailable") {
            l.warn("tool alias target unavailable", {
              tool: failed.toolCall.toolName,
              repaired: aliasRepair.toolName,
              reason: aliasRepair.reason,
              availableTools: activeToolNames,
            })
            // Returning null preserves the original tool call and lets the AI SDK
            // emit its native invalid/no-such-tool error with the requested name.
            // Never route an unrecoverable call through the internal `invalid`
            // placeholder: it is intentionally excluded from activeTools.
            return null
          }
          if (repairedTool && repairedTool !== failed.toolCall.toolName) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: repairedTool,
              reason: "normalized available tool name",
            })
            return {
              ...failed.toolCall,
              toolName: repairedTool,
            }
          }
          l.warn("tool call unavailable", {
            tool: failed.toolCall.toolName,
            availableTools: activeToolNames,
            error: failed.error.message,
          })
          // The call is not safely repairable. Returning null is important here:
          // the SDK then keeps the original tool name and surfaces the real parse
          // or availability error instead of producing "unavailable tool invalid".
          return null
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
        activeTools: activeToolNames,
        tools,
        toolChoice: input.toolChoice,
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: input.abort,
        headers: {
          ...(input.model.providerID.startsWith("lfcode")
            ? {
                "x-lfcode-project": Instance.project.id,
                "x-lfcode-session": input.sessionID,
                "x-lfcode-request": input.user.id,
                "x-lfcode-client": Flag.LFCODE_CLIENT,
              }
            : {
                "x-session-affinity": input.sessionID,
                ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
                "User-Agent": `lfcode/${InstallationVersion}`,
              }),
          ...input.model.headers,
          ...headers,
        },
        // Keep provider retries visible at the processor/session layer instead
        // of the SDK's internal silent retry loop. Internal retries hide long
        // waits behind a plain busy spinner and delay surfaced retry status.
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                }
                return args.params
              },
            },
          ],
        }),
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          functionId: "session.llm",
          tracer: telemetryTracer,
          metadata: {
            userId: cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      })

      return result
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )
            const abortSignal = input.abortSignal
            if (abortSignal) {
              yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    const abort = () => ctrl.abort()
                    if (abortSignal.aborted) {
                      abort()
                      return undefined
                    }
                    abortSignal.addEventListener("abort", abort, { once: true })
                    return abort
                  }),
                  (abort) =>
                    Effect.sync(() => {
                      if (abort) abortSignal.removeEventListener("abort", abort)
                    }),
                )
            }
            const attemptRef = yield* Ref.make(0)

            const publishRetryEvent = (error: unknown, nextAttempt: number) =>
              Effect.gen(function* () {
                log.debug("retry attempt", {
                  sessionID: input.sessionID,
                  messageID: input.user.id,
                  attempt: nextAttempt,
                  reason: error instanceof Error ? error.message : String(error),
                })
                if (nextAttempt > 10) return
                const delayMs = Math.min(500 * 2 ** (nextAttempt - 1), 300_000)
                yield* Effect.promise(() =>
                  Bus.publish(Session.Event.RetryAttempt, {
                    sessionID: SessionID.make(input.sessionID),
                    messageID: input.user.id,
                    attempt: nextAttempt,
                    maxAttempts: 10,
                    reason: error instanceof Error ? error.message : String(error),
                    nextDelayMs: delayMs,
                  })
                )
              })

            const streamWithTelemetry = run({ ...input, abort: ctrl.signal }).pipe(
              Effect.tapError((error) => {
                if (!isTransientCapacityError(error)) return Effect.void
                return Ref.updateAndGet(attemptRef, (n) => n + 1).pipe(
                  Effect.flatMap((nextAttempt) => publishRetryEvent(error, nextAttempt))
                )
              })
            )

            const result = yield* streamWithTelemetry.pipe(
              Effect.retry({
                while: isTransientCapacityError,
                schedule: persistentRetrySchedule,
              }),
            )
            let abortDrain: PromiseLike<void> | undefined
            const startAbortDrain = () => {
              if (abortDrain) return abortDrain
              abortDrain = result.consumeStream({
                onError(error) {
                  log.debug("streamText abort drain error", {
                    sessionID: input.sessionID,
                    messageID: input.user.id,
                    error: error instanceof Error ? error.message : String(error),
                  })
                },
              })
              return abortDrain
            }
            if (ctrl.signal.aborted) {
              void startAbortDrain()
            } else {
              ctrl.signal.addEventListener(
                "abort",
                () => {
                  void startAbortDrain()
                },
                { once: true },
              )
            }

            const consumeStartTs = Date.now()
            let sawFirstChunk = false
            const fullStream = (async function* () {
              try {
                yield { type: "start" } as Event
                yield {
                  type: "start-step",
                  request: {},
                  warnings: [],
                } as Event
                for await (const chunk of normalizeTextLifecycle(gateProviderStreamChunks(result.fullStream, ctrl.signal))) {
                  if (!sawFirstChunk) {
                    sawFirstChunk = true
                    const elapsedMs = Date.now() - consumeStartTs
                    const sinceSubmitMs = input.submitAt ? Date.now() - input.submitAt : undefined
                    log.debug("streamText first chunk", {
                      sessionID: input.sessionID,
                      messageID: input.user.id,
                      elapsedMs,
                      sinceSubmitMs,
                      chunkType:
                        chunk && typeof chunk === "object" && "type" in chunk
                          ? String((chunk as { type: unknown }).type)
                          : typeof chunk,
                    })
                    if (sinceSubmitMs && sinceSubmitMs >= 5000) {
                      log.info("streamText delayed first chunk", {
                        sessionID: input.sessionID,
                        messageID: input.user.id,
                        sinceSubmitMs,
                        elapsedMs,
                      })
                    }
                  }
                  yield chunk
                }
              } finally {
                if (abortDrain) {
                  await Promise.race([
                    Promise.resolve(abortDrain).catch(() => {}),
                    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
                  ])
                }
                log.debug("streamText finished", {
                  sessionID: input.sessionID,
                  messageID: input.user.id,
                  elapsedMs: Date.now() - consumeStartTs,
                  sinceSubmitMs: input.submitAt ? Date.now() - input.submitAt : undefined,
                  sawFirstChunk,
                })
              }
            })()

            return Stream.fromAsyncIterable(fullStream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ stream, buildSystemArray })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ActorRegistry.defaultLayer),
    Layer.provide(Memory.defaultLayer),
  ),
)

function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLM from "./llm"
