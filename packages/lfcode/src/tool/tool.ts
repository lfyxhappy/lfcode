import z from "zod"
import { Effect } from "effect"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

export interface Metadata {
  [key: string]: any
}

export type Kind =
  | "file"
  | "search"
  | "execution"
  | "automation"
  | "task"
  | "memory"
  | "agent"
  | "system"
  | "custom"

export type Recovery = "none" | "retry" | "reread" | "alternative" | "user"
export type LatencyClass = "instant" | "fast" | "io" | "network" | "long"

export type DefinitionMetadata = {
  kind: Kind
  namespace: string
  readOnly: boolean
  recovery: Recovery
  latencyClass: LatencyClass
}

export type ValidationErrorCategory = "schema" | "format" | "context" | "permission" | "runtime"

export type ValidationError = {
  type: "tool_error"
  tool: string
  category: ValidationErrorCategory
  field?: string
  fields?: string[]
  expected?: string
  retryable: boolean
  recovery: string
  message: string
}

export function defaultMetadata(id: string): DefinitionMetadata {
  if (["read", "file_info", "tree", "archive_inspect", "edit_history"].includes(id)) {
    return {
      kind: id === "tree" || id === "file_info" ? "search" : "file",
      namespace: "file",
      readOnly: true,
      recovery: "reread",
      latencyClass: "io",
    }
  }
  if (["search", "websearch", "codesearch", "grep", "glob"].includes(id)) {
    return {
      kind: "search",
      namespace: id === "websearch" ? "web" : "file",
      readOnly: true,
      recovery: "retry",
      latencyClass: id === "websearch" ? "network" : "io",
    }
  }
  if (["apply_patch", "replace_range", "symbol_edit", "write", "edit"].includes(id)) {
    return { kind: "file", namespace: "file", readOnly: false, recovery: "reread", latencyClass: "io" }
  }
  if (["shell", "bash", "python", "pip", "cpp", "runtime_manage", "shell_process"].includes(id)) {
    return {
      kind: "execution",
      namespace: "runtime",
      readOnly: false,
      recovery: "retry",
      latencyClass: id === "shell_process" ? "long" : "io",
    }
  }
  if (["credential_manage", "provider_manage", "mcp_manage", "skill_manage", "hook_manage", "plugin_manage", "capability_manage"].includes(id)) {
    return { kind: "system", namespace: "agent-os", readOnly: false, recovery: "user", latencyClass: "io" }
  }
  if (["task", "goal", "create_goal", "get_goal", "update_goal"].includes(id)) {
    return {
      kind: "task",
      namespace: "planning",
      readOnly: id === "get_goal",
      recovery: "retry",
      latencyClass: "fast",
    }
  }
  if (["actor", "app-control"].includes(id) || id.startsWith("app_")) {
    return {
      kind: "automation",
      namespace: id.startsWith("app_") ? "app" : "agent",
      readOnly: false,
      recovery: "user",
      latencyClass: "io",
    }
  }
  if (["memory", "history", "skill", "context_broker"].includes(id)) {
    return {
      kind: id === "memory" ? "memory" : "system",
      namespace: "context",
      readOnly: id !== "skill",
      recovery: "retry",
      latencyClass: "io",
    }
  }
  return { kind: "custom", namespace: "custom", readOnly: false, recovery: "user", latencyClass: "io" }
}

export function definitionMetadata(def: Pick<Def, "id" | "metadata">): DefinitionMetadata {
  return def.metadata ?? defaultMetadata(def.id)
}

export function classifyValidationError(error: unknown): ValidationErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  if (/permission|not permitted|denied|access/i.test(message)) return "permission"
  if (/context|fresh read|stale|does not match|not found/i.test(message)) return "context"
  if (/format|patch|parse|syntax/i.test(message)) return "format"
  if (/invalid argument|schema|expected|required|unrecognized/i.test(message)) return "schema"
  return "runtime"
}

export function formatValidationError(input: { tool: string; error: z.ZodError; recovery?: string }): string {
  const issue = input.error.issues[0]
  const field = issue?.path.length ? issue.path.join(".") : undefined
  const fields = [...new Set(input.error.issues.map((item) => item.path.join(".")).filter(Boolean))].sort()
  const detail = input.error.issues
    .map((item) => `${item.path.length ? item.path.join(".") : "arguments"}: ${item.message}`)
    .join("; ")
  const value: ValidationError = {
    type: "tool_error",
    tool: input.tool,
    category: "schema",
    ...(field ? { field } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    retryable: true,
    recovery: input.recovery ?? "Correct only the reported field and do not repeat the same arguments unchanged.",
    message: detail,
  }
  return [`[tool_error] ${JSON.stringify(value)}`, detail, `Recovery: ${value.recovery}`].join("\n")
}

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  actorID?: string
  taskId?: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

export type ToolExecutionContext = {
  toolID: string
  callID?: string
  sessionID: SessionID
  messageID: MessageID
  parentCallID?: string
  startedAt: number
}

export type ToolExecutionOutcome<M extends Metadata = Metadata> =
  | { type: "success"; result: ExecuteResult<M>; durationMs: number }
  | { type: "denied"; reason: string; durationMs: number }
  | { type: "failure"; category: ValidationErrorCategory; error: string; durationMs: number }

export type ToolPreExecuteHook = (input: ToolExecutionContext & { args: unknown }) => void | { args?: unknown; deny?: string }
export type ToolExecutionGuard = (input: ToolExecutionContext & { args: unknown }) => string | undefined
export type ToolExecuteWrapper = (
  input: ToolExecutionContext & { args: unknown; signal: AbortSignal },
  next: () => Effect.Effect<ExecuteResult>,
) => Effect.Effect<ExecuteResult>
export type ToolPostExecuteHook = (input: ToolExecutionContext & { args: unknown; result: ExecuteResult }) => void | ExecuteResult
export type ToolResultObserver = (input: ToolExecutionContext & { outcome: ToolExecutionOutcome }) => void

const preExecuteHooks = new Set<ToolPreExecuteHook>()
const executionGuards = new Set<ToolExecutionGuard>()
const executeWrappers = new Set<ToolExecuteWrapper>()
const postExecuteHooks = new Set<ToolPostExecuteHook>()
const resultObservers = new Set<ToolResultObserver>()

export function registerPreExecuteHook(hook: ToolPreExecuteHook) {
  preExecuteHooks.add(hook)
  return () => preExecuteHooks.delete(hook)
}

export function registerExecutionGuard(guard: ToolExecutionGuard) {
  executionGuards.add(guard)
  return () => executionGuards.delete(guard)
}

export function registerExecuteWrapper(wrapper: ToolExecuteWrapper) {
  executeWrappers.add(wrapper)
  return () => executeWrappers.delete(wrapper)
}

export function registerPostExecuteHook(hook: ToolPostExecuteHook) {
  postExecuteHooks.add(hook)
  return () => postExecuteHooks.delete(hook)
}

export function registerResultObserver(observer: ToolResultObserver) {
  resultObservers.add(observer)
  return () => resultObservers.delete(observer)
}

function observe(execution: ToolExecutionContext, outcome: ToolExecutionOutcome) {
  for (const observer of resultObservers) {
    try {
      observer({ ...execution, outcome })
    } catch {
      // Result observers are read-only telemetry and may not change settlement.
    }
  }
}

export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  description: string
  parameters: Parameters
  metadata?: DefinitionMetadata
  /** Skill that must be loaded in the active session before this extension tool is exposed. */
  activationSkill?: string
  execute(args: z.infer<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  finalizeContent?(result: ExecuteResult<M>, execution: ToolExecutionContext): ExecuteResult<M>
  formatValidationError?(error: z.ZodError): string
  shell?: {
    description: string
    parse(script: string): Effect.Effect<z.infer<Parameters>[], unknown>
    // Optional recovery for shell-mode calls that arrive shaped like the tool's
    // JSON args (no usable `script`). Returns the tool's parsed JSON shape to be
    // routed to execute, or undefined if rawArgs can't be lifted. Lets shell mode
    // transparently accept a JSON-shape call instead of erroring.
    recover?(rawArgs: unknown): z.infer<Parameters> | undefined
  }
}
export type DefWithoutID<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> = Omit<
  Def<Parameters, M>,
  "id"
>

export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends z.ZodType, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any> ? z.infer<P> : T extends Effect.Effect<Info<infer P, any>, any, any> ? z.infer<P> : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

function wrap<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        const execution: ToolExecutionContext = {
          toolID: id,
          ...(ctx.callID ? { callID: ctx.callID } : {}),
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          ...(typeof ctx.extra?.parentCallID === "string" ? { parentCallID: ctx.extra.parentCallID } : {}),
          startedAt: Date.now(),
        }
        let denial: string | undefined
        const pipeline = Effect.gen(function* () {
          const parsedArgs =
            ctx.extra?.internalSubtask === true
              ? (args as z.infer<typeof toolInfo.parameters>)
              : yield* Effect.try({
                  try: () => toolInfo.parameters.parse(args),
                  catch: (error) => {
                    if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                      return new Error(toolInfo.formatValidationError(error), { cause: error })
                    }
                    if (error instanceof z.ZodError) {
                      return new Error(formatValidationError({ tool: id, error }), { cause: error })
                    }
                    return new Error(
                      `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                      { cause: error },
                    )
                  },
                })
          let nextArgs: unknown = parsedArgs
          for (const hook of preExecuteHooks) {
            const change = hook({ ...execution, args: nextArgs })
            if (change?.deny) {
              denial = change.deny
              return { title: "Tool execution denied", output: change.deny, metadata: {} as Result }
            }
            if (change?.args !== undefined) nextArgs = change.args
          }
          for (const guard of executionGuards) {
            const reason = guard({ ...execution, args: nextArgs })
            if (!reason) continue
            denial = reason
            return { title: "Tool execution denied", output: reason, metadata: {} as Result }
          }
          const invoke = [...executeWrappers]
            .toReversed()
            .reduce<() => Effect.Effect<ExecuteResult>>(
              (next, wrapper) => () => wrapper({ ...execution, args: nextArgs, signal: ctx.abort }, next),
              () => execute(nextArgs as z.infer<typeof toolInfo.parameters>, ctx) as Effect.Effect<ExecuteResult>,
            )
          const result = yield* invoke()
          const post = [...postExecuteHooks].reduce(
            (current, hook) => hook({ ...execution, args: nextArgs, result: current }) ?? current,
            result as ExecuteResult,
          )
          const finalized = (toolInfo.finalizeContent
            ? toolInfo.finalizeContent(post as ExecuteResult<Result>, execution)
            : post) as ExecuteResult<Result>
          if (typeof finalized.title !== "string" || typeof finalized.output !== "string" || !finalized.metadata) {
            throw new Error("Tool finalizer must return canonical title, output, and metadata")
          }
          if (finalized.metadata.truncated !== undefined) {
            return finalized
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(finalized.output, {}, agent)
          return {
            ...finalized,
            output: truncated.content,
            metadata: {
              ...finalized.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputRef: truncated.outputRef }),
            },
          }
        })
        return pipeline.pipe(
          Effect.tap((result) =>
            Effect.sync(() =>
              observe(
                execution,
                denial
                  ? { type: "denied", reason: denial, durationMs: Date.now() - execution.startedAt }
                  : { type: "success", result, durationMs: Date.now() - execution.startedAt },
              ),
            ),
          ),
          Effect.tapError((error) =>
            Effect.sync(() =>
              observe(execution, {
                type: "failure",
                category: classifyValidationError(error),
                error: error instanceof Error ? error.message : String(error),
                durationMs: Date.now() - execution.startedAt,
              }),
            ),
          ),
          Effect.orDie,
          Effect.withSpan("Tool.execute", { attributes: attrs }),
        )
      }
      return toolInfo
    })
}

export function define<Parameters extends z.ZodType, Result extends Metadata, R, ID extends string = string>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function defineStatic<Parameters extends z.ZodType, Result extends Metadata, ID extends string = string>(
  id: ID,
  parameters: Parameters,
  init: Omit<DefWithoutID<Parameters, Result>, "parameters">,
) {
  return define(id, Effect.succeed({ ...init, parameters }))
}

export function init<P extends z.ZodType, M extends Metadata>(info: Info<P, M>): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}
