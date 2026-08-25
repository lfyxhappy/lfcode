import {
  readLfcodePluginManifest,
  type Hooks,
  type PluginInput,
  type Plugin as PluginInstance,
  type PluginModule,
  type WorkspaceAdaptor as PluginWorkspaceAdaptor,
  type ActorPreStopInput,
  type ActorPostStopInput,
  type ActorStopOutput,
  type ActorMatcher,
} from "@lfcode-ai/plugin"
import path from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import { matchesActor } from "./matcher"
import { Config, ConfigMarkdown } from "../config"
import { ConfigPlugin } from "../config/plugin"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Log } from "../util"
import { createLfcodeClient } from "@lfcode-ai/sdk"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { AnthropicProxyPlugin } from "./anthropic-proxy"
import { Session } from "../session"
import type { SessionID } from "../session/schema"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { CheckpointSplitoverPlugin } from "./checkpoint-splitover"
import { SubagentProgressCheckerPlugin } from "./subagent-progress-checker"
import { Effect, Layer, Context, Stream } from "effect"
import { EffectBridge } from "@/effect"
import { InstanceState } from "@/effect"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier, pluginSource, readPluginId, readV1Plugin, resolvePluginId } from "./shared"
import { registerAdaptor } from "@/control-plane/adaptors"
import type { WorkspaceAdaptor } from "@/control-plane/types"
import { getRuntimeManageState } from "@/runtime-registry"
import { Skill } from "@/skill"
import { Project } from "@/project"
import { backend, createPluginSecureStorage } from "./secure-storage"
import { MessageV2 } from "@/session/message-v2"
import { isUserHiddenSystemActorID } from "@/actor/visibility"

const log = Log.create({ service: "plugin" })
const EXTERNAL_PLUGIN_STARTUP_TIMEOUT_MS = 5_000

function isUserVisiblePluginEvent(input: { type: string; properties: Record<string, unknown> }) {
  if (input.properties.visible === false) return false
  if (typeof input.properties.actorID === "string" && isUserHiddenSystemActorID(input.properties.actorID)) return false
  if (input.type === "message.updated") {
    const info = input.properties.info
    return !!info && typeof info === "object" && MessageV2.isUserVisible(info as MessageV2.Info)
  }
  if (input.type === "message.part.updated") {
    const part = input.properties.part
    if (!part || typeof part !== "object" || !("sessionID" in part) || !("messageID" in part)) return false
    return MessageV2.isUserVisibleMessage({
      sessionID: part.sessionID as MessageV2.Info["sessionID"],
      messageID: part.messageID as MessageV2.Info["id"],
    })
  }
  if (input.type === "message.part.delta" || input.type === "message.part.removed" || input.type === "message.removed") {
    if (typeof input.properties.sessionID !== "string" || typeof input.properties.messageID !== "string") return false
    return MessageV2.isUserVisibleMessage({
      sessionID: input.properties.sessionID as MessageV2.Info["sessionID"],
      messageID: input.properties.messageID as MessageV2.Info["id"],
    })
  }
  return true
}

export const HookEvent = {
  Executed: BusEvent.define(
    "hook.executed",
    z.object({
      event: z.enum(["actor.preStop", "actor.postStop"]),
      hookID: z.string(),
      pluginName: z.string(),
      actorID: z.string(),
      agentType: z.string(),
      durationMs: z.number(),
      outcome: z.enum(["success", "error", "skipped"]),
      continueRequested: z.boolean(),
      reasonLength: z.number(),
    }),
  ),
  ReActReentered: BusEvent.define(
    "hook.react.reentered",
    z.object({
      phase: z.enum(["pre", "post"]),
      actorID: z.string(),
      agentType: z.string(),
      iteration: z.number(),
      triggeredByPlugins: z.array(z.string()),
      reasonPreview: z.string(),
    }),
  ),
  ReActMaxReached: BusEvent.define(
    "hook.react.max_reached",
    z.object({
      phase: z.enum(["pre", "post"]),
      actorID: z.string(),
      agentType: z.string(),
    }),
  ),
} as const

type HookEntry = {
  hook: Hooks
  pluginName: string
  /** Stable per-event hook ID: `${pluginName}#${eventName}` */
  hookIDFor: (eventName: string) => string
}

export type RuntimeStatus = {
  id: string
  spec: string
  source: "internal" | "file" | "npm" | "managed"
  lifecycle: "active" | "disabled" | "degraded"
  error?: string
}

type State = {
  hooks: Hooks[]
  hooksWithMeta: HookEntry[]
  status: RuntimeStatus[]
  data: Map<string, string>
  actions: Map<string, Map<string, PluginAction>>
}

type PluginAction = NonNullable<Hooks["action"]>[string]

export type ActorStopAggregatedDecision = ActorStopOutput & {
  contributingPluginNames: string[]
  contributingHookIDs: string[]
}

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly status: () => Effect.Effect<RuntimeStatus[]>
  readonly data: (pluginID: string) => Effect.Effect<string | undefined>
  readonly action: (pluginID: string, name: string, input: unknown) => Effect.Effect<unknown>
  readonly reload: () => Effect.Effect<void>
  readonly init: () => Effect.Effect<void>
  readonly triggerActorPreStop: (
    input: ActorPreStopInput,
  ) => Effect.Effect<ActorStopAggregatedDecision>
  readonly triggerActorPostStop: (
    input: ActorPostStopInput,
  ) => Effect.Effect<ActorStopAggregatedDecision>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Plugin") {}

// Built-in plugins that are directly imported (not installed from npm)
const INTERNAL_PLUGINS: PluginInstance[] = [
  AnthropicProxyPlugin,
  CodexAuthPlugin,
  CopilotAuthPlugin,
  CloudflareWorkersAuthPlugin,
  CloudflareAIGatewayAuthPlugin,
  CheckpointSplitoverPlugin,
  SubagentProgressCheckerPlugin,
]

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

async function applyPlugin(
  load: PluginLoader.Loaded,
  input: PluginInput,
  hooks: Hooks[],
  hooksWithMeta: HookEntry[],
  data: Map<string, string>,
  actions: Map<string, Map<string, PluginAction>>,
  skill: Skill.Interface,
): Promise<RuntimeStatus[]> {
  const bundledSkillOwner = await registerPluginBundledSkills(load, skill)
  try {
    await requirePluginRuntimeDependencies(load)
    await requirePluginSkillRequirements(load, skill)
    const pluginInput = await withPluginDataDirectory(load, input)
    if (pluginInput.data) {
      const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
      for (const id of [load.spec, load.pkg?.json.name, manifest?.id]) {
        if (typeof id === "string" && id) data.set(id, pluginInput.data)
      }
    }
    const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
    if (plugin) {
      const pluginName = await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
      const hookObj = await (plugin as PluginModule).server(pluginInput, load.options)
      registerPluginActions(pluginName, hookObj, actions)
      hooks.push(hookObj)
      hooksWithMeta.push({
        hook: hookObj,
        pluginName,
        hookIDFor: (event: string) => `${pluginName}#${event}`,
      })
      return [
        {
          id: pluginName,
          spec: load.spec,
          source: load.source,
          lifecycle: "active",
        },
      ]
    }

    const status: RuntimeStatus[] = []
    for (const server of getLegacyPlugins(load.mod)) {
      const fnName = (server as { name?: string }).name
      const fallbackID = fnName && fnName !== "default" && fnName !== "" ? fnName : undefined
      const pluginName = await resolvePluginId(load.source, load.spec, load.target, fallbackID, load.pkg)
      const hookObj = await server(pluginInput, load.options)
      registerPluginActions(pluginName, hookObj, actions)
      hooks.push(hookObj)
      hooksWithMeta.push({
        hook: hookObj,
        pluginName,
        hookIDFor: (event: string) => `${pluginName}#${event}`,
      })
      if (pluginInput.data) data.set(pluginName, pluginInput.data)
      status.push({
        id: pluginName,
        spec: load.spec,
        source: load.source,
        lifecycle: "active",
      })
    }
    return status
  } catch (error) {
    if (bundledSkillOwner) await Effect.runPromise(skill.unregisterPluginSkills(bundledSkillOwner))
    throw error
  }
}

async function registerPluginBundledSkills(load: PluginLoader.Loaded, skill: Skill.Interface) {
  const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
  if (!manifest?.bundledSkills?.length) return
  if (!manifest.id || !load.pkg) throw new Error(`Plugin ${load.spec} must declare an id before bundling Skills`)

  const root = path.resolve(load.pkg.dir)
  const entries = await Promise.all(
    manifest.bundledSkills.map(async (entry) => {
      const location = path.resolve(root, entry.path)
      const relative = path.relative(root, location)
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Plugin ${load.spec} bundled Skill resolves outside the plugin package: ${entry.path}`)
      }
      const markdown = await ConfigMarkdown.parse(location)
      const parsed = Skill.Info.safeParse({
        ...markdown.data,
        location,
        content: markdown.content,
      })
      if (!parsed.success) throw new Error(`Plugin ${load.spec} has invalid bundled Skill ${entry.path}`)
      if (parsed.data.name !== entry.id) {
        throw new Error(`Plugin ${load.spec} bundled Skill ${entry.path} must declare name: ${entry.id}`)
      }
      return parsed.data
    }),
  )
  await Effect.runPromise(skill.registerPluginSkills({ pluginID: manifest.id, skills: entries }))
  return manifest.id
}

async function withPluginDataDirectory(load: PluginLoader.Loaded, input: PluginInput): Promise<PluginInput> {
  const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
  if (load.source !== "file" || !load.pkg || !manifest?.storage?.data) return input
  if (!new Set(["plugin", "plugins"]).has(path.basename(path.dirname(load.pkg.dir)).toLowerCase())) return input

  const data = path.join(load.pkg.dir, "data")
  await mkdir(data, { recursive: true })
  return { ...input, data, secureStorage: createPluginSecureStorage(data, backend()) }
}

function registerPluginActions(pluginID: string, hook: Hooks, actions: Map<string, Map<string, PluginAction>>) {
  if (!hook.action) return
  const registered = actions.get(pluginID) ?? new Map<string, PluginAction>()
  for (const [name, action] of Object.entries(hook.action)) registered.set(name, action)
  actions.set(pluginID, registered)
}

async function requirePluginRuntimeDependencies(load: PluginLoader.Loaded) {
  const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
  const required = manifest?.runtimeDependencies?.filter((dependency) => dependency.required !== false) ?? []
  if (required.length === 0) return
  const runtime = await getRuntimeManageState()
  const missing = required.filter((dependency) => !runtime.items.find((item) => item.id === dependency.id)?.installed)
  if (missing.length === 0) return
  throw new Error(`Missing required runtime dependencies: ${missing.map((dependency) => dependency.id).join(", ")}`)
}

async function requirePluginSkillRequirements(load: PluginLoader.Loaded, skill: Skill.Interface) {
  const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
  const required = manifest?.skillRequirements?.filter((dependency) => dependency.required !== false) ?? []
  if (required.length === 0) return
  const available = new Set((await Effect.runPromise(skill.all())).map((item) => item.name))
  const missing = required.filter((dependency) => !available.has(dependency.id))
  if (missing.length === 0) return
  throw new Error(`Missing required skills: ${missing.map((dependency) => dependency.id).join(", ")}`)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const skill = yield* Skill.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const hooks: Hooks[] = []
        const hooksWithMeta: HookEntry[] = []
        const status: RuntimeStatus[] = []
        const data = new Map<string, string>()
        const actions = new Map<string, Map<string, PluginAction>>()
        const bridge = yield* EffectBridge.make()

        function publishPluginError(message: string) {
          bridge.fork(bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))
        const sdkV2 = yield* Effect.promise(() => import("@lfcode-ai/sdk/v2"))

        const client = createLfcodeClient({
          baseUrl: "http://localhost:4096",
          directory: ctx.directory,
          headers: Flag.LFCODE_SERVER_PASSWORD
            ? {
                Authorization: `Basic ${Buffer.from(`${Flag.LFCODE_SERVER_USERNAME ?? "lfcode"}:${Flag.LFCODE_SERVER_PASSWORD}`).toString("base64")}`,
              }
            : undefined,
          fetch: Object.assign(
            (request: RequestInfo | URL, init?: RequestInit) => Server.Default().app.fetch(new Request(request, init)),
            globalThis.fetch,
          ),
        })
        const clientV2 = sdkV2.createLfcodeClient({
          baseUrl: "http://localhost:4096",
          directory: ctx.directory,
          headers: Flag.LFCODE_SERVER_PASSWORD
            ? {
                Authorization: `Basic ${Buffer.from(`${Flag.LFCODE_SERVER_USERNAME ?? "lfcode"}:${Flag.LFCODE_SERVER_PASSWORD}`).toString("base64")}`,
              }
            : undefined,
          fetch: Object.assign(
            (request: RequestInfo | URL, init?: RequestInit) => Server.Default().app.fetch(new Request(request, init)),
            globalThis.fetch,
          ),
        })
        const cfg = yield* config.get()
        const input: PluginInput = {
          client,
          clientV2,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          secureStorage: {
            status: () => "unavailable",
            get: async () => undefined,
            set: async () => {
              throw new Error("Secure credential storage is only available to installed local plugins")
            },
            remove: async () => {},
          },
          experimental_workspace: {
            register(type: string, adaptor: PluginWorkspaceAdaptor) {
              registerAdaptor(ctx.project.id, type, adaptor as WorkspaceAdaptor)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const plugin of INTERNAL_PLUGINS) {
          log.info("loading internal plugin", { name: plugin.name })
          let failure: string | undefined
          const init = yield* Effect.tryPromise({
            try: () => plugin(input),
            catch: (err) => {
              failure = errorMessage(err)
              log.error("failed to load internal plugin", { name: plugin.name, error: err })
            },
          }).pipe(Effect.option)
          if (init._tag === "Some") {
            hooks.push(init.value)
            hooksWithMeta.push({
              hook: init.value,
              pluginName: plugin.name,
              hookIDFor: (event: string) => `${plugin.name}#${event}`,
            })
            status.push({ id: plugin.name, spec: plugin.name, source: "internal", lifecycle: "active" })
            continue
          }
          status.push({
            id: plugin.name,
            spec: plugin.name,
            source: "internal",
            lifecycle: "degraded",
            ...(failure ? { error: failure } : {}),
          })
        }

        const configured = cfg.plugin_origins ?? []
        const disabled = new Set(
          configured
            .filter((origin) => cfg.plugin_enabled?.[ConfigPlugin.pluginSpecifier(origin.spec)] === false)
            .map((origin) => ConfigPlugin.pluginSpecifier(origin.spec)),
        )
        for (const spec of disabled) {
          status.push({ id: spec, spec, source: pluginSource(spec), lifecycle: "disabled" })
        }
        const plugins = Flag.LFCODE_PURE ? [] : configured.filter((origin) => !disabled.has(ConfigPlugin.pluginSpecifier(origin.spec)))
        if (Flag.LFCODE_PURE && cfg.plugin_origins?.length) {
          log.info("skipping external plugins in pure mode", { count: cfg.plugin_origins.length })
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            report: {
              start(candidate) {
                log.info("loading plugin", { path: candidate.plan.spec })
              },
              missing(candidate, _retry, message) {
                log.warn("plugin has no server entrypoint", { path: candidate.plan.spec, message })
                status.push({
                  id: candidate.plan.spec,
                  spec: candidate.plan.spec,
                  source: pluginSource(candidate.plan.spec),
                  lifecycle: "degraded",
                  error: message,
                })
              },
              error(candidate, _retry, stage, error, resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)
                status.push({
                  id: spec,
                  spec,
                  source: pluginSource(spec),
                  lifecycle: "degraded",
                  error: message,
                })

                if (stage === "install") {
                  const parsed = parsePluginSpecifier(spec)
                  log.error("failed to install plugin", { pkg: parsed.pkg, version: parsed.version, error: message })
                  publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                  return
                }

                if (stage === "compatibility") {
                  log.warn("plugin incompatible", { path: spec, error: message })
                  publishPluginError(`Plugin ${spec} skipped: ${message}`)
                  return
                }

                if (stage === "entry") {
                  log.error("failed to resolve plugin server entry", { path: spec, error: message })
                  publishPluginError(`Failed to load plugin ${spec}: ${message}`)
                  return
                }

                log.error("failed to load plugin", { path: spec, target: resolved?.entry, error: message })
                publishPluginError(`Failed to load plugin ${spec}: ${message}`)
              },
            },
          }),
        )
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          // Plugin startup runs while the current Instance is booting. Keep its
          // hooks isolated until initialization succeeds so a bad plugin cannot
          // hold every instance-scoped route (sessions, projects, MCPs) forever.
          const pluginHooks: Hooks[] = []
          const pluginHooksWithMeta: HookEntry[] = []
          const outcome = yield* Effect.tryPromise({
            try: () =>
              new Promise<{ status: "completed"; items: RuntimeStatus[] } | { status: "timed_out" }>(
                (resolve, reject) => {
                  const timeout = setTimeout(
                    () => resolve({ status: "timed_out" }),
                    EXTERNAL_PLUGIN_STARTUP_TIMEOUT_MS,
                  )
                  void applyPlugin(load, input, pluginHooks, pluginHooksWithMeta, data, actions, skill).then(
                    (items) => {
                      clearTimeout(timeout)
                      resolve({ status: "completed", items })
                    },
                    (error) => {
                      clearTimeout(timeout)
                      reject(error)
                    },
                  )
                },
              ),
            catch: (err) => err,
          }).pipe(
            Effect.catch((err) => {
              const message = errorMessage(err)
              log.error("failed to load plugin", { path: load.spec, error: message })
              status.push({
                id: load.spec,
                spec: load.spec,
                source: load.source,
                lifecycle: "degraded",
                error: message,
              })
              return Effect.succeed({ status: "failed" as const })
            }),
          )
          if (outcome.status === "failed") continue
          if (outcome.status === "timed_out") {
            const message = `Plugin startup timed out after ${EXTERNAL_PLUGIN_STARTUP_TIMEOUT_MS}ms`
            log.error("plugin startup timed out", { path: load.spec, timeout: EXTERNAL_PLUGIN_STARTUP_TIMEOUT_MS })
            status.push({
              id: load.spec,
              spec: load.spec,
              source: load.source,
              lifecycle: "degraded",
              error: message,
            })
            publishPluginError(`Failed to load plugin ${load.spec}: ${message}`)
            continue
          }
          hooks.push(...pluginHooks)
          hooksWithMeta.push(...pluginHooksWithMeta)
          status.push(...outcome.items)

          const manifest = load.pkg ? readLfcodePluginManifest(load.pkg.json.lfcode, load.spec) : undefined
          const managedProject = manifest?.managedProject
          const pluginID = manifest?.id ?? outcome.items[0]?.id
          // ImageMaker used to own a managed workspace. Retire only that legacy
          // project index; its plugin-private gallery and secure configuration stay intact.
          if (!managedProject && pluginID === "lfcode-imagemaker") {
            yield* Effect.promise(() =>
              Project.removeManagedProject({ pluginID: "lfcode-imagemaker", type: "imagemaker" }),
            )
          }
          const dataDirectory = pluginID ? data.get(pluginID) : undefined
          if (!managedProject || !pluginID || !dataDirectory) continue
          yield* Effect.promise(() =>
            Project.ensureManagedProject({
              extension: { pluginID, type: managedProject.type },
              worktree: path.join(dataDirectory, managedProject.worktree),
              name: managedProject.name,
            }),
          )
        }

        // Notify plugins of current config
        for (const hook of hooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((hook as any).config?.(cfg)),
            catch: (err) => {
              log.error("plugin config hook failed", { error: err })
            },
          }).pipe(Effect.ignore)
        }

        // Subscribe to bus events, fiber interrupted when scope closes
        yield* bus.subscribeAll().pipe(
          Stream.runForEach((input) =>
            Effect.sync(() => {
              if (!isUserVisiblePluginEvent(input as { type: string; properties: Record<string, unknown> })) return
              for (const hook of hooks) {
                void hook["event"]?.({ event: input as any })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return { hooks, hooksWithMeta, status, data, actions }
      }),
    )

    const aggregateDecision = (
      input: ActorPreStopInput | ActorPostStopInput,
      eventName: "actor.preStop" | "actor.postStop",
    ) =>
      Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        const reasons: string[] = []
        const pluginNames: string[] = []
        const hookIDs: string[] = []
        let anyContinue = false

        for (const entry of s.hooksWithMeta) {
          const reg = entry.hook[eventName]
          if (!reg) continue

          const fn = typeof reg === "function" ? reg : reg.run
          const matcher: ActorMatcher | undefined =
            typeof reg === "function" ? undefined : reg.matcher

          if (!matchesActor(matcher, input)) {
            yield* bus.publish(HookEvent.Executed, {
              event: eventName,
              hookID: entry.hookIDFor(eventName),
              pluginName: entry.pluginName,
              actorID: input.actorID,
              agentType: input.agentType,
              durationMs: 0,
              outcome: "skipped",
              continueRequested: false,
              reasonLength: 0,
            })
            continue
          }

          const startedAt = Date.now()
          const o: ActorStopOutput = { continue: false }
          let hookOutcome: "success" | "error" = "success"
          // TODO: pass an AbortSignal to fn so plugin authors can wire cooperative
          // cancellation into their fetch / DB calls. Effect interrupt only stops
          // the awaiting fiber — the underlying Promise keeps running and may
          // bus.publish events after the actor has been cleaned up. See spec
          // Future work for full discussion. Strict in-process cancellation
          // (子进程隔离) is out of scope; AbortSignal is the in-process ceiling.
          yield* Effect.tryPromise({
            try: () => fn(input as never, o),
            catch: (err) => err,
          }).pipe(
            Effect.tapError((err) =>
              Effect.gen(function* () {
                hookOutcome = "error"
                log.error(`${eventName} hook failed`, { pluginName: entry.pluginName, hookID: entry.hookIDFor(eventName), error: err })
                yield* bus.publish(Session.Event.Error, {
                  sessionID: input.sessionID as SessionID,
                  error: new NamedError.Unknown({
                    message: `${eventName} hook (${entry.pluginName}) failed: ${errorMessage(err)}`,
                  }).toObject(),
                })
              }),
            ),
            Effect.ignore,
          )

          const durationMs = Date.now() - startedAt
          yield* bus.publish(HookEvent.Executed, {
            event: eventName,
            hookID: entry.hookIDFor(eventName),
            pluginName: entry.pluginName,
            actorID: input.actorID,
            agentType: input.agentType,
            durationMs,
            outcome: hookOutcome,
            continueRequested: o.continue === true,
            reasonLength: o.reason?.length ?? 0,
          })

          if (o.continue === true && o.reason && o.reason.length > 0) {
            anyContinue = true
            reasons.push(o.reason)
            pluginNames.push(entry.pluginName)
            hookIDs.push(entry.hookIDFor(eventName))
          } else if (o.continue === true) {
            log.warn(`${eventName} hook returned continue=true without reason; ignored`, {
              pluginName: entry.pluginName,
            })
          }
        }

        const aggregated: ActorStopAggregatedDecision = {
          continue: anyContinue,
          reason: reasons.length > 0 ? reasons.join("\n\n") : undefined,
          contributingPluginNames: pluginNames,
          contributingHookIDs: hookIDs,
        }
        return aggregated
      })

    const triggerActorPreStop = Effect.fn("Plugin.triggerActorPreStop")(function* (
      input: ActorPreStopInput,
    ) {
      return yield* aggregateDecision(input, "actor.preStop")
    })

    const triggerActorPostStop = Effect.fn("Plugin.triggerActorPostStop")(function* (
      input: ActorPostStopInput,
    ) {
      return yield* aggregateDecision(input, "actor.postStop")
    })

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* InstanceState.get(state)
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* InstanceState.get(state)
      return s.hooks
    })

    const status = Effect.fn("Plugin.status")(function* () {
      if (!(yield* InstanceState.has(state))) return []
      return (yield* InstanceState.get(state)).status.map((item) => ({ ...item }))
    })

    const dataForPlugin = Effect.fn("Plugin.data")(function* (pluginID: string) {
      return (yield* InstanceState.get(state)).data.get(pluginID)
    })

    const action = Effect.fn("Plugin.action")(function* (pluginID: string, name: string, input: unknown) {
      const registered = (yield* InstanceState.get(state)).actions.get(pluginID)?.get(name)
      if (!registered) throw new Error(`Plugin action '${name}' is unavailable for ${pluginID}`)
      return yield* Effect.promise(() => registered.execute(registered.input.parse(input)))
    })

    const reload = Effect.fn("Plugin.reload")(function* () {
      yield* skill.clearPluginSkills()
      yield* InstanceState.invalidate(state)
      yield* InstanceState.get(state)
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, status, data: dataForPlugin, action, reload, init, triggerActorPreStop, triggerActorPostStop })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Plugin from "."
