import { Log } from "../util"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fsNode from "fs/promises"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { Instance, type InstanceContext } from "../project/instance"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Account } from "@/account/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@/filesystem"
import { InstanceState } from "@/effect"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { EffectFlock } from "@/util/effect-flock"
import { InstanceRef } from "@/effect/instance-ref"
import { zod, ZodOverride } from "@/util/effect-zod"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigFormatter } from "./formatter"
import { ConfigHistory } from "./history"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigManaged } from "./managed"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"
import { ConfigServer } from "./server"
import { ConfigVariable } from "./variable"
import { Npm } from "@/npm"
import { listManagedPluginSpecs, registryFile } from "@/plugin/library"

const log = Log.create({ service: "config" })

// Custom merge function that concatenates array fields instead of replacing them
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = ConfigPlugin.normalizePluginConfigAliases({ ...data })
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy || "skills" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  delete copy.skills
  log.warn("legacy keys in lfcode config are deprecated; move them to tui.json and skills/ under the lfcode config root", {
    path: source,
  })
  return copy
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

function localPluginDir() {
  try {
    return path.dirname(import.meta.resolve("@lfcode-ai/plugin/package.json"))
  } catch {
    return
  }
}

export const Server = ConfigServer.Server.zod
export const Layout = ConfigLayout.Layout.zod
export type Layout = ConfigLayout.Layout

// Schemas that still live at the zod layer (have .transform / .preprocess /
// .meta not expressible in current Effect Schema) get referenced via a
// ZodOverride-annotated Schema.Any.  Walker sees the annotation and emits the
// exact zod directly, preserving component $refs.
const AgentRef = Schema.Any.annotate({ [ZodOverride]: ConfigAgent.Info })
const PermissionRef = Schema.Any.annotate({ [ZodOverride]: ConfigPermission.Info })
const LogLevelRef = Schema.Any.annotate({ [ZodOverride]: Log.Level })

const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))

const InfoSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServer.Server).annotate({
    description: "Server configuration for lfcode serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommand.Info)).annotate({
    description: "Command configuration, see https://lfcode.ai/docs/commands",
  }),
  watcher: Schema.optional(
    Schema.Struct({
      ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPlugin.Spec))),
  plugin_enabled: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description: "Enable or disable configured plugins by their canonical spec without removing their configuration",
  }),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  model_groups: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        // string shorthand: group is just its default model
        ConfigModelID,
        Schema.Struct({
          default: ConfigModelID,
          models: Schema.optional(Schema.mutable(Schema.Array(ConfigModelID))),
        }),
      ]),
    ),
  ).annotate({
    description:
      "Named model groups (capability tiers, e.g. ultra/standard/lite). Each group has a default model and optional member models. A group name can be used anywhere a provider/model string is accepted.",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(AgentRef),
        plan: Schema.optional(AgentRef),
      }),
      [Schema.Record(Schema.String, AgentRef)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(AgentRef),
        build: Schema.optional(AgentRef),
        // subagent
        general: Schema.optional(AgentRef),
        explore: Schema.optional(AgentRef),
        // specialized
        title: Schema.optional(AgentRef),
        summary: Schema.optional(AgentRef),
        compaction: Schema.optional(AgentRef),
      }),
      [Schema.Record(Schema.String, AgentRef)],
    ),
  ).annotate({ description: "Agent configuration, see https://lfcode.ai/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        ConfigMCP.Info,
        // Matches the legacy `{ enabled: false }` form used to disable a server.
        Schema.Any.annotate({ [ZodOverride]: z.object({ enabled: z.boolean() }).strict() }),
      ]),
    ),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatter.Info),
  lsp: Schema.optional(ConfigLSP.Info),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayout.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(PermissionRef),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  tool: Schema.optional(
    Schema.Struct({
      invocation_style: Schema.optional(Schema.Literals(["json", "shell"])).annotate({
        description:
          "Default invocation style for all tools. 'json' (default) exposes the original Zod schema; 'shell' exposes a single `script` parameter and uses the tool's shell.parse mapping.",
      }),
      invocation_style_by_tool: Schema.optional(
        Schema.Record(Schema.String, Schema.Literals(["json", "shell"])),
      ).annotate({
        description:
          "Per-tool override of invocation_style. Keys are tool IDs. A tool without a `shell` field falls back to JSON regardless of this setting.",
      }),
    }),
  ).annotate({
    description: "Tool invocation style configuration (JSON vs shell-style).",
  }),
  app_control: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable or disable model access to local desktop app-control tools. Default: false.",
      }),
      permission: Schema.optional(
        Schema.Literals(["read_only", "session_control", "browser_control", "full_app_control"]),
      ).annotate({
        description:
          "Permission level for desktop app-control tools. 'read_only' allows state inspection only, 'session_control' allows navigation and composer actions, 'browser_control' additionally allows side-browser actions, and 'full_app_control' reserves broader future control.",
      }),
    }),
  ).annotate({
    description: "Host-level desktop app-control configuration.",
  }),
  enterprise: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }),
    }),
  ),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  checkpoint: Schema.optional(
    Schema.Struct({
      thresholds: Schema.optional(Schema.Array(Schema.String)).annotate({
        description:
          "Context fill thresholds that trigger checkpoint writes. Strings may be percentages (\"40%\"), absolute tokens (\"100K\", \"1.5M\"), or mixed (\"100K\", \"50%\"). Each threshold must be <= window - 20K reserved. No default thresholds are applied; direct compaction is the default hot path unless thresholds are explicitly configured.",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer reserved for checkpoint operations. Default: 20000.",
      }),
      max_writer_failures: Schema.optional(PositiveInt).annotate({
        description:
          "Maximum consecutive writer failures per session before checkpointing stops retrying until process restart. Default: 3.",
      }),
      fork: Schema.optional(Schema.Boolean).annotate({
        description:
          "Whether to fork the parent agent's message prefix into the writer session for prefix-cache reuse. Requires provider cache-breakpoint support. Default: false.",
      }),
      push_caps: Schema.optional(
        Schema.Struct({
          tasks_ledger: Schema.optional(PositiveInt).annotate({
            description: "Token cap for the tasks ledger section of rebuild context. Default: 2000.",
          }),
          focus_task: Schema.optional(PositiveInt).annotate({
            description: "Token cap for the focus task body in rebuild context. Default: 4000.",
          }),
          actor_ledger: Schema.optional(PositiveInt).annotate({
            description: "Token cap for the actor ledger section of rebuild context. Default: 500.",
          }),
          memory_titles: Schema.optional(PositiveInt).annotate({
            description: "Token cap for memory titles in rebuild context. Default: 500.",
          }),
          global: Schema.optional(PositiveInt).annotate({
            description:
              "Token cap for the global memory section (global/MEMORY.md) of rebuild context. Default: 6000.",
          }),
          checkpoint: Schema.optional(PositiveInt).annotate({
            description:
              "Token cap for the session checkpoint section (checkpoint.md) of rebuild context. Default: 11000.",
          }),
          memory: Schema.optional(PositiveInt).annotate({
            description: "Token cap for the project memory section (MEMORY.md) of rebuild context. Default: 16000.",
          }),
          memory_spillover_total: Schema.optional(PositiveInt).annotate({
            description:
              "Token cap for the total relevant topic memory spillover content auto-injected into rebuild context. Default: 4000.",
          }),
          memory_spillover_files: Schema.optional(PositiveInt).annotate({
            description:
              "Maximum number of project MEMORY-<topic>.md spillover files auto-injected into rebuild context. Default: 2.",
          }),
          notes: Schema.optional(PositiveInt).annotate({
            description: "Token cap for the session notes (notes.md) of rebuild context. Default: 6000.",
          }),
          design_decisions: Schema.optional(PositiveInt).annotate({
            description: "Token cap for §10 Design decisions section of checkpoint.md (writer-side budget validation). Default: 3000.",
          }),
          open_notes: Schema.optional(PositiveInt).annotate({
            description: "Token cap for §11 Open notes section of checkpoint.md (writer-side budget validation). Default: 800.",
          }),
        }),
      ).annotate({
        description:
          "Per-section token caps for rebuild context (renderRebuildContext). Each section is loaded up to its cap so the rebuild stays within a predictable budget.",
      }),
      task_archive_days: Schema.optional(PositiveInt).annotate({
        description: "Number of days after task done/abandoned before it's filtered out of `list({include_archived: false})`. Rows are NOT deleted — see v9 for true GC. Default: 7.",
      }),
      task_cleanup_days: Schema.optional(PositiveInt).annotate({
        description: "[deprecated] Alias for task_archive_days. Will be removed in v9.",
      }),
      memory_reconcile_on_search: Schema.optional(Schema.Boolean).annotate({
        description: "Whether to reconcile memory state on search operations. Default: true.",
      }),
      memory_search_score_floor: Schema.optional(Schema.Number).annotate({
        description:
          "Relative BM25 floor for memory.search (OR-joined query): keep results scoring >= this fraction of the top hit, dropping common-word-only noise. The #1 result is always kept. Default: 0.15. Set 0 to keep all matches.",
      }),
    }),
  ),
  memory: Schema.optional(
    Schema.Struct({
      cc_index: Schema.optional(Schema.Boolean).annotate({
        description:
          "Index Claude Code memory (~/.claude/projects/<slug>/memory) and expose under scope='cc'. Default: false. Note: when enabled, every lfcode agent (build/explore/subagents) can search these memories via the builtin `memory` tool — including CC's `type: user` (your role/preferences) and `type: feedback` (your guidance) categories. CC originally writes them for future CC sessions; flipping this on widens the consumer set to lfcode agents on the same machine. Leave disabled (default) if you don't want personal context recallable from a prompt-injection-vulnerable agent.",
      }),
    }),
  ),
  history: Schema.optional(ConfigHistory.Info).annotate({
    description: "Trajectory (conversation history) FTS index configuration.",
  }),
  dream: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description:
          "Auto-trigger dream memory consolidation on new session start. Default: true.",
      }),
      interval_days: Schema.optional(NonNegativeInt).annotate({
        description: "Minimum days between automatic dream runs. Set to 0 to trigger on every new session. Default: 7.",
      }),
    }),
  ),
  distill: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description:
          "Auto-trigger distill workflow packaging on new session start. Default: true.",
      }),
      interval_days: Schema.optional(NonNegativeInt).annotate({
        description: "Minimum days between automatic distill runs. Default: 30.",
      }),
    }),
  ),
  maintenance: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable host-level Dream and Distill memory maintenance. Default: true.",
      }),
      scheduler_enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Allow the daily maintenance scheduler to claim automatic runs. Default: true.",
      }),
      dream_enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Run Dream consolidation as part of maintenance. Default: true.",
      }),
      distill_enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Run Distill candidate analysis as part of maintenance. Default: true.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      predict_next_prompt: Schema.optional(Schema.Boolean).annotate({
        description:
          "Predict the user's likely next prompt after each turn and show it as inline ghost text (Tab to accept). Enabled by default; set to false to disable.",
      }),
      maxMode: Schema.optional(
        Schema.Struct({
          candidates: Schema.optional(PositiveInt).annotate({
            description: "Number of parallel reasoning candidates per step in max mode (default 5).",
          }),
        }),
      ).annotate({
        description:
          "Max mode (experimental): the 'max' agent runs N parallel reasoning candidates each step, picks the best via a judge call, and executes only the winner.",
      }),
    }),
  ),
  workflow: Schema.optional(
    Schema.Struct({
      maxConcurrentAgents: Schema.optional(Schema.Number).annotate({
        description:
          "Process-wide ceiling on subagents running concurrently across ALL workflow runs (including nested children). Default min(16, 2x CPU cores). No upper clamp: the previous 2x-cores hard cap was removed so an operator can match real provider capacity — but that also means a misconfigured value (e.g. an extra zero) can exhaust provider rate limits or host memory. This is the only concurrency ceiling, so set it deliberately.",
      }),
      maxDepth: Schema.optional(Schema.Number).annotate({
        description: "Max nesting depth for workflow()-calls-workflow. Default 8. Exceeding it fails the run.",
      }),
      maxLifecycleAgents: Schema.optional(Schema.Number).annotate({
        description:
          "Hard ceiling on total agents a single workflow run may spawn over its life. Default 1000. Over-cap agent() calls return null (graceful degradation). PER-RUN, not tree-wide: each child workflow has its own independent budget, so a deep nesting can spawn maxDepth × this over the whole tree (concurrent in-flight is still bounded by maxConcurrentAgents).",
      }),
      scriptDeadlineMs: Schema.optional(Schema.Number).annotate({
        description:
          "Wall-clock budget for a whole workflow script, in milliseconds. Default 12h. The sandbox interrupt handler enforces this as a hard kill-switch.",
      }),
    }),
  ).annotate({ description: "Dynamic workflow runtime settings." }),
})

// Schema.Struct produces readonly types by default, but the service code
// below mutates Info objects directly (e.g. `config.mode = ...`). Strip the
// readonly recursively so callers get the same mutable shape zod inferred.
//
// `Types.DeepMutable` from effect-smol would be a drop-in, but its fallback
// branch `{ -readonly [K in keyof T]: ... }` collapses `unknown` to `{}`
// (since `keyof unknown = never`), which widens `Record<string, unknown>`
// fields like `ConfigPlugin.Options`. The local version gates on
// `extends object` so `unknown` passes through.
//
// Tuple branch preserves `ConfigPlugin.Spec`'s `readonly [string, Options]`
// shape (otherwise the general array branch widens it to an array).
type DeepMutable<T> = T extends readonly [unknown, ...unknown[]]
  ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T

// The walker emits `z.object({...})` which is non-strict by default. Config
// historically uses `.strict()` (additionalProperties: false in openapi.json),
// so layer that on after derivation.  Re-apply the Config ref afterward
// since `.strict()` strips the walker's meta annotation.
export const Info = (zod(InfoSchema) as unknown as z.ZodObject<any>)
  .strict()
  .meta({ ref: "Config" }) as unknown as z.ZodType<DeepMutable<Schema.Schema.Type<typeof InfoSchema>>>

export type Info = z.output<typeof Info> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
  mcp_origins?: Record<string, ConfigMCP.Origin>
}

export const Patch = z.object({}).catchall(z.any()).meta({ ref: "ConfigPatch" })
export type Patch = z.infer<typeof Patch>

export const GlobalPersonalizationMemory = z
  .object({
    ccIndex: z.boolean(),
    autoConsolidation: z.boolean(),
  })
  .meta({ ref: "GlobalPersonalizationMemory" })
export type GlobalPersonalizationMemory = z.infer<typeof GlobalPersonalizationMemory>

export const GlobalPersonalizationMaintenance = z
  .object({
    enabled: z.boolean(),
    schedulerEnabled: z.boolean(),
    dreamEnabled: z.boolean(),
    distillEnabled: z.boolean(),
  })
  .meta({ ref: "GlobalPersonalizationMaintenance" })
export type GlobalPersonalizationMaintenance = z.infer<typeof GlobalPersonalizationMaintenance>

export const GlobalPersonalizationSave = z
  .object({
    customInstructions: z.string(),
    memory: GlobalPersonalizationMemory,
    maintenance: GlobalPersonalizationMaintenance,
  })
  .meta({ ref: "GlobalPersonalizationSave" })
export type GlobalPersonalizationSave = z.infer<typeof GlobalPersonalizationSave>

export const GlobalPersonalization = z
  .object({
    customInstructions: z.string(),
    instructionFile: z.string(),
    memory: GlobalPersonalizationMemory,
    maintenance: GlobalPersonalizationMaintenance,
    config: Info,
  })
  .meta({ ref: "GlobalPersonalization" })
export type GlobalPersonalization = z.infer<typeof GlobalPersonalization>

function resolvePersonalizationMaintenance(config: Info): GlobalPersonalizationMaintenance {
  return {
    enabled: config.maintenance?.enabled ?? true,
    schedulerEnabled: config.maintenance?.scheduler_enabled ?? true,
    dreamEnabled: config.maintenance?.dream_enabled ?? config.dream?.auto ?? true,
    distillEnabled: config.maintenance?.distill_enabled ?? config.distill?.auto ?? true,
  }
}

export const GlobalAppControlPermission = z
  .enum(["read_only", "session_control", "browser_control", "full_app_control"])
  .meta({ ref: "GlobalAppControlPermission" })
export type GlobalAppControlPermission = z.infer<typeof GlobalAppControlPermission>

export const GlobalAppControlSave = z
  .object({
    enabled: z.boolean(),
    permission: GlobalAppControlPermission,
  })
  .meta({ ref: "GlobalAppControlSave" })
export type GlobalAppControlSave = z.infer<typeof GlobalAppControlSave>

export const GlobalAppControlService = z
  .object({
    discoveryFile: z.string(),
    detected: z.boolean(),
    host: z.string().optional(),
    port: z.number().optional(),
    pid: z.number().optional(),
    version: z.string().optional(),
    startedAt: z.number().optional(),
  })
  .meta({ ref: "GlobalAppControlService" })
export type GlobalAppControlService = z.infer<typeof GlobalAppControlService>

export const GlobalAppControl = z
  .object({
    enabled: z.boolean(),
    permission: GlobalAppControlPermission,
    target: z.literal("app"),
    availableTargets: z.array(z.literal("app")),
    service: GlobalAppControlService,
    config: Info,
  })
  .meta({ ref: "GlobalAppControl" })
export type GlobalAppControl = z.infer<typeof GlobalAppControl>

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getGlobalPersonalization: () => Effect.Effect<GlobalPersonalization>
  readonly getGlobalAppControl: () => Effect.Effect<GlobalAppControl>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Patch) => Effect.Effect<Info>
  readonly saveGlobalPersonalization: (input: GlobalPersonalizationSave) => Effect.Effect<GlobalPersonalization>
  readonly saveGlobalAppControl: (input: GlobalAppControlSave) => Effect.Effect<GlobalAppControl>
  readonly upsertGlobalCustomProvider: (
    providerID: string,
    config: ConfigProvider.Info,
    key?: string,
  ) => Effect.Effect<Info>
  readonly removeGlobalCustomProvider: (providerID: string) => Effect.Effect<Info>
  readonly upsertMcp: (
    name: string,
    config: ConfigMCP.Info,
    options?: { target?: "auto" | "project" | "global" },
  ) => Effect.Effect<Info>
  readonly removeMcp: (name: string) => Effect.Effect<Info>
  readonly updateMcpEnabled: (name: string, enabled: boolean) => Effect.Effect<Info>
  readonly updatePluginEnabled: (spec: string, enabled: boolean) => Effect.Effect<Info>
  readonly invalidate: (wait?: boolean) => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Config") {}

const GLOBAL_CONFIG_FILES = [
  "lfcode.jsonc",
  "lfcode.json",
  "lfcode.jsonc",
  "lfcode.json",
  "config.json",
] as const

function globalConfigFile() {
  const candidates = GLOBAL_CONFIG_FILES.map((file) => path.join(Global.Path.config, file))
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function globalConfigFiles() {
  return GLOBAL_CONFIG_FILES.map((file) => path.join(Global.Path.config, file))
}

function globalPersonalizationFile() {
  return path.join(Global.Path.config, "instructions", "personalization.md")
}

function globalAppControlStateFile() {
  if (process.env.LFCODE_AUTOMATION_STATE_FILE) return process.env.LFCODE_AUTOMATION_STATE_FILE
  if (process.env.LFCODE_STATE_DIR) return path.join(process.env.LFCODE_STATE_DIR, "automation", "desktop.json")
  return path.join(Global.Path.home, ".lfcode", "state", "automation", "desktop.json")
}

async function readGlobalAppControlService() {
  const discoveryFile = globalAppControlStateFile()
  const text = await fsNode.readFile(discoveryFile, "utf8").catch(() => undefined)
  if (!text) {
    return {
      discoveryFile,
      detected: false,
    } satisfies GlobalAppControlService
  }
  try {
    const parsed = JSON.parse(text) as {
      host?: unknown
      pid?: unknown
      port?: unknown
      startedAt?: unknown
      version?: unknown
    }
    return {
      discoveryFile,
      detected: true,
      host: typeof parsed.host === "string" ? parsed.host : undefined,
      port: typeof parsed.port === "number" ? parsed.port : undefined,
      pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
    } satisfies GlobalAppControlService
  } catch {
    return {
      discoveryFile,
      detected: false,
    } satisfies GlobalAppControlService
  }
}

export function resolveGlobalAppControlConfig(config: Info | undefined) {
  return {
    enabled: config?.app_control?.enabled ?? false,
    permission: config?.app_control?.permission ?? "session_control",
  } satisfies GlobalAppControlSave
}

function normalizePersonalizationText(input: string) {
  return input.replace(/\r\n/g, "\n")
}

function hasPersonalizationText(input: string) {
  return input.trim().length > 0
}

function updateManagedInstructionPath(instructions: string[] | undefined, managedPath: string, enabled: boolean) {
  const result: string[] = []
  let inserted = false
  for (const item of instructions ?? []) {
    if (item !== managedPath) {
      result.push(item)
      continue
    }
    if (!enabled || inserted) continue
    result.push(managedPath)
    inserted = true
  }
  if (enabled && !inserted) {
    result.push(managedPath)
  }
  return result.length > 0 ? result : undefined
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...path, key])
  }, input)
}

function deleteJsoncPath(input: string, path: string[]) {
  if (!input.trim()) return input
  if (!hasJsoncPath(ConfigParse.jsonc(input, "<delete-jsonc-path>"), path)) return input
  const edits = modify(input, path, undefined, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
  })
  if (edits.length === 0) return input
  return applyEdits(input, edits)
}

function hasJsoncPath(input: unknown, path: string[]): boolean {
  if (path.length === 0) return true
  if (!isRecord(input)) return false
  const [head, ...rest] = path
  if (!(head in input)) return false
  return hasJsoncPath((input as Record<string, unknown>)[head], rest)
}

function collectNullPaths(input: unknown, path: string[] = []): string[][] {
  if (input === null) return [path]
  if (!isRecord(input)) return []
  return Object.entries(input).flatMap(([key, value]) => collectNullPaths(value, [...path, key]))
}

function stripNulls(input: unknown): unknown {
  if (input === null) return undefined
  if (Array.isArray(input)) return input.map(stripNulls)
  if (!isRecord(input)) return input
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [key, stripNulls(value)]),
  )
}

function deleteObjectPath(input: Record<string, unknown>, path: string[]) {
  if (path.length === 0) return input
  const [head, ...rest] = path
  if (rest.length === 0) {
    delete input[head]
    return input
  }
  const next = input[head]
  if (!isRecord(next)) return input
  deleteObjectPath(next, rest)
  if (Object.keys(next).length === 0) delete input[head]
  return input
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, mcp_origins: _mcp_origins, ...next } = info
  return next
}

function isCustomProviderConfig(config: ConfigProvider.Info | undefined) {
  if (!config) return false
  const knownCustomPackages = new Set([
    "@ai-sdk/openai-compatible",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
  ])
  if (config.npm && !knownCustomPackages.has(config.npm)) return false
  if (typeof config.options?.baseURL !== "string" || config.options.baseURL.length === 0) return false
  if (!config.models || Object.keys(config.models).length === 0) return false
  return true
}

export function withoutGlobalCustomProvider(info: Info, providerID: string) {
  const next = mergeDeep({}, writable(info))

  if (next.provider?.[providerID]) delete next.provider[providerID]
  if (next.provider && Object.keys(next.provider).length === 0) delete next.provider

  if (!next.disabled_providers) return next

  const filtered = next.disabled_providers.filter((id) => id !== providerID)
  if (filtered.length === 0) {
    delete next.disabled_providers
    return next
  }

  next.disabled_providers = filtered
  return next
}

export function withGlobalCustomProvider(info: Info, providerID: string, provider: ConfigProvider.Info) {
  const next = mergeDeep({}, writable(info))
  next.provider = {
    ...next.provider,
    [providerID]: provider,
  }
  if (!next.disabled_providers) return next

  const filtered = next.disabled_providers.filter((id) => id !== providerID)
  if (filtered.length === 0) {
    delete next.disabled_providers
    return next
  }

  next.disabled_providers = filtered
  return next
}

function mcpPatch(name: string, config: ConfigMCP.Info, enabled: boolean): Info {
  return {
    mcp: {
      [name]: {
        ...config,
        enabled,
      },
    },
  }
}

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
        Effect.orDie,
      )
    })

    const readOptionalFile = Effect.fnUntraced(function* (filepath: string) {
      return yield* Effect.promise(() =>
        fsNode.readFile(filepath, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        }),
      )
    })

    const writeFileAtomic = Effect.fnUntraced(function* (filepath: string, content: string) {
      const dir = path.dirname(filepath)
      const temp = path.join(dir, `.${path.basename(filepath)}.${process.pid}.${Date.now()}.tmp`)
      yield* Effect.promise(() => fsNode.mkdir(dir, { recursive: true }))
      yield* Effect.promise(async () => {
        try {
          await fsNode.writeFile(temp, content)
          await fsNode.rename(temp, filepath)
        } finally {
          await fsNode.unlink(temp).catch(() => {})
        }
      })
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options ? { text, type: "path", path: options.path } : { text, type: "virtual", ...options },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = ConfigParse.schema(Info, normalizeLoadedConfig(parsed, source), source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://lfcode.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://lfcode.ai/config.json",')
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = pipe(
        {},
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "config.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "lfcode.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "lfcode.jsonc"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "lfcode.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "lfcode.jsonc"))),
      )

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://lfcode.ai/config.json"
              result = mergeDeep(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "LFCODE_CONFIG_CONTENT") return "local"
          if (yield* InstanceRef.use((ctx) => Effect.succeed(Instance.containsPath(source, ctx)))) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPlugin.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const mergeMcpOrigins = (source: string, next: Info, type: ConfigMCP.Origin["type"]) => {
          if (!next.mcp) return
          result.mcp_origins = {
            ...(result.mcp_origins ?? {}),
            ...Object.fromEntries(Object.keys(next.mcp).map((name) => [name, { type, source }])),
          }
        }

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          mergeMcpOrigins(source, next, "lfcode")
          return mergePluginOrigins(source, next.plugin, kind)
        }

        const readClaudeConfig = Effect.fnUntraced(function* (source: string) {
          const text = yield* readConfigFile(source)
          if (!text) return undefined
          return yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: () => new Error(`failed to parse ${source}; Claude Code MCP compatibility skipped.`),
          }).pipe(
            Effect.tapError((error) => Effect.sync(() => log.warn(error.message))),
            Effect.option,
            Effect.map(Option.getOrUndefined),
          )
        })

        const mergeClaudeMcp = Effect.fnUntraced(function* (source: string) {
          const data = yield* readClaudeConfig(source)
          if (!isRecord(data)) return
          if (!isRecord(data.mcpServers)) return

          for (const [name, server] of Object.entries(data.mcpServers)) {
            const existing = result.mcp?.[name]
            if (existing && result.mcp_origins?.[name]?.type !== "claude") {
              log.info(`skipped Claude Code MCP server "${name}"; native lfcode MCP with same name already exists.`)
              continue
            }

            const converted = ConfigMCP.fromClaude(name, server)
            if ("warning" in converted) {
              log.warn(converted.warning)
              continue
            }

            const next = ConfigParse.schema(Info, { mcp: { [name]: converted.config } }, source)
            result.mcp = {
              ...(result.mcp ?? {}),
              [name]: next.mcp![name],
            }
            result.mcp_origins = {
              ...(result.mcp_origins ?? {}),
              [name]: { type: "claude", source },
            }
          }
        })

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            process.env[value.key] = value.token
            const source = `${url}/.well-known/lfcode`
            log.debug("fetching remote config", { url: source })
            const response = yield* Effect.promise(() => fetch(source, { signal: AbortSignal.timeout(1000) }))
            if (!response.ok) {
              throw new Error(`failed to fetch remote config from ${url}`)
            }
            const wellknown = (yield* Effect.promise(() => response.json())) as { config?: Record<string, unknown> }
            const remoteConfig = wellknown.config ?? {}
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://lfcode.ai/config.json"
            const next = yield* loadConfig(JSON.stringify(remoteConfig), {
              dir: path.dirname(source),
              source,
            })
            yield* merge(source, next, "global")
            log.debug("loaded remote config from well-known", { url })
          }
        }

        const global = yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        if (Flag.LFCODE_CONFIG) {
          yield* merge(Flag.LFCODE_CONFIG, yield* loadFile(Flag.LFCODE_CONFIG))
          log.debug("loaded custom config", { path: Flag.LFCODE_CONFIG })
        }

        if (!Flag.LFCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("lfcode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* merge(file, yield* loadFile(file), "local")
          }
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.LFCODE_CONFIG_DIR) {
          log.debug("loading config from LFCODE_CONFIG_DIR", { path: Flag.LFCODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void, never>[] = []

        // Load Claude Code commands first so .lfcode commands override on name collision.
        for (const dir of yield* ConfigPaths.claudeCommandDirectories(ctx.directory, ctx.worktree)) {
          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
        }

        for (const dir of directories) {
          if (dir.endsWith(".lfcode") || dir === Flag.LFCODE_CONFIG_DIR) {
            const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
            const pluginDir = localPluginDir()
            if (list.length && pluginDir) {
              // Only prepare dependencies for directories that actually ship local plugins.
              // Most project config roots do not contain plugin code, so skipping the install
              // avoids unnecessary npm resolution and registry traffic during project switches.
              const dep = yield* npmSvc
                .install(dir, {
                  add: [
                    {
                      name: pluginDir,
                    },
                  ],
                })
                .pipe(
                  Effect.exit,
                  Effect.tap((exit) =>
                    Exit.isFailure(exit)
                      ? Effect.sync(() => {
                          log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                        })
                      : Effect.void,
                  ),
                  Effect.asVoid,
                  Effect.forkDetach,
                )
              deps.push(dep)
            }
            if (list.length && !pluginDir) {
              log.warn("skipped local plugin dependency bootstrap; bundled @lfcode-ai/plugin runtime is unavailable", {
                dir,
              })
            }
            yield* mergePluginOrigins(dir, list)
            for (const file of ["lfcode.json", "lfcode.jsonc", "lfcode.json", "lfcode.jsonc"]) {
              const source = path.join(dir, file)
              log.debug(`loading config from ${source}`)
              yield* merge(source, yield* loadFile(source))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
        }

        yield* mergePluginOrigins(
          registryFile(),
          yield* Effect.promise(() => listManagedPluginSpecs()),
          "global",
        )

        if (process.env.LFCODE_CONFIG_CONTENT) {
          const source = "LFCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.LFCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* merge(source, next, "local")
          log.debug("loaded custom config from LFCODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["LFCODE_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("LFCODE_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                dir: path.dirname(source),
                source,
              })
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) => {
              log.debug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              })
              return Effect.void
            }),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["lfcode.json", "lfcode.jsonc", "lfcode.json", "lfcode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          const next = yield* loadConfig(managed.text, {
            dir: path.dirname(managed.source),
            source: managed.source,
          })
          result = mergeConfigConcatArrays(result, next)
          mergeMcpOrigins(managed.source, next, "lfcode")
        }

        if (!Flag.LFCODE_DISABLE_CLAUDE_CODE_MCP) {
          yield* mergeClaudeMcp(path.join(Global.Path.home, ".claude.json"))
          yield* mergeClaudeMcp(path.join(ctx.directory, ".claude.json"))
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.LFCODE_PERMISSION) {
          result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.LFCODE_PERMISSION))
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermission.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermission.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) result.username = os.userInfo().username

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        if (Flag.LFCODE_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.LFCODE_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }

        return {
          config: result,
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(AppFileSystem.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const updateConfigFile = Effect.fnUntraced(function* (file: string, patch: Info) {
      const before =
        (yield* Effect.promise(() =>
          fsNode.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined
            throw error
          }),
        )) ?? "{}"

      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), writable(patch))
        yield* Effect.promise(() => fsNode.writeFile(file, JSON.stringify(merged, null, 2)))
        return merged
      }

      const updated = patchJsonc(before, writable(patch))
      const next = ConfigParse.schema(Info, ConfigParse.jsonc(updated, file), file)
      yield* Effect.promise(() => fsNode.writeFile(file, updated))
      return next
    })

    const resolveProjectOverrideFile = Effect.fnUntraced(function* () {
      const dir = yield* InstanceState.directory
      return path.join(dir, ".lfcode", "lfcode.jsonc")
    })

    const resolveManagedMcpTarget = Effect.fnUntraced(function* (target: "auto" | "project" | "global" | undefined, name: string, current: Info) {
      if (target === "project") return yield* resolveProjectOverrideFile()
      if (target === "global") return globalConfigFile()
      return yield* resolveMcpConfigTarget(name, current)
    })

    const resolveMcpConfigTarget = Effect.fnUntraced(function* (name: string, current: Info) {
      const origin = current.mcp_origins?.[name]
      if (!origin) return globalConfigFile()
      if (origin.type === "claude") {
        if (origin.source === path.join(Global.Path.home, ".claude.json")) return globalConfigFile()
        return yield* resolveProjectOverrideFile()
      }
      if (origin.source === Global.Path.config) return globalConfigFile()
      if (origin.source.startsWith("http://") || origin.source.startsWith("https://")) return globalConfigFile()
      return origin.source
    })

    const resolvePluginConfigTarget = Effect.fnUntraced(function* (spec: string, current: Info) {
      const origin = current.plugin_origins?.find((item) => ConfigPlugin.pluginSpecifier(item.spec) === spec)
      if (!origin) throw new Error(`Plugin ${spec} is not configured`)
      if (origin.source === Global.Path.config) return globalConfigFile()
      if (origin.source.startsWith("http://") || origin.source.startsWith("https://")) {
        throw new Error(`Plugin ${spec} was declared by a remote configuration and cannot be updated locally`)
      }
      return origin.source
    })

    const upsertMcp = Effect.fn("Config.upsertMcp")(function* (
      name: string,
      config: ConfigMCP.Info,
      options?: { target?: "auto" | "project" | "global" },
    ) {
      const current = yield* get()
      const target = yield* resolveManagedMcpTarget(options?.target, name, current)
      yield* Effect.promise(() => fsNode.mkdir(path.dirname(target), { recursive: true }))
      yield* updateConfigFile(target, { mcp: { [name]: config } })
      if (path.dirname(target) === Global.Path.config) {
        yield* invalidateGlobal
      }
      yield* InstanceState.invalidate(state)
      return yield* get()
    })

    const removeMcp = Effect.fn("Config.removeMcp")(function* (name: string) {
      const current = yield* get()
      const mcp = current.mcp?.[name]
      if (!mcp || !("type" in mcp)) throw new Error(`MCP server ${name} not found or invalid`)

      const target = yield* resolveMcpConfigTarget(name, current)
      const before =
        (yield* Effect.promise(() =>
          fsNode.readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined
            throw error
          }),
        )) ?? "{}"

      yield* Effect.promise(() => fsNode.mkdir(path.dirname(target), { recursive: true }))

      if (!target.endsWith(".jsonc")) {
        const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, target), target)
        const next = mergeDeep({}, writable(existing))
        if (next.mcp?.[name]) delete next.mcp[name]
        if (next.mcp && Object.keys(next.mcp).length === 0) delete next.mcp
        yield* Effect.promise(() => fsNode.writeFile(target, JSON.stringify(next, null, 2)))
      } else {
        let updated = deleteJsoncPath(before, ["mcp", name])
        const parsed = ConfigParse.schema(Info, ConfigParse.jsonc(updated, target), target)
        if (parsed.mcp && Object.keys(parsed.mcp).length === 0) {
          updated = deleteJsoncPath(updated, ["mcp"])
        }
        yield* Effect.promise(() => fsNode.writeFile(target, updated))
      }

      if (path.dirname(target) === Global.Path.config) {
        yield* invalidateGlobal
      }
      yield* InstanceState.invalidate(state)
      return yield* get()
    })

    const updateMcpEnabled = Effect.fn("Config.updateMcpEnabled")(function* (name: string, enabled: boolean) {
      const current = yield* get()
      const mcp = current.mcp?.[name]
      if (!mcp || !("type" in mcp)) throw new Error(`MCP server ${name} not found or invalid`)

      const target = yield* resolveMcpConfigTarget(name, current)
      yield* Effect.promise(() => fsNode.mkdir(path.dirname(target), { recursive: true }))
      const next = yield* updateConfigFile(target, mcpPatch(name, mcp, enabled))
      if (path.dirname(target) === Global.Path.config) {
        yield* invalidateGlobal
      }
      yield* InstanceState.invalidate(state)
      return mergeConfigConcatArrays(current, next)
    })

    const updatePluginEnabled = Effect.fn("Config.updatePluginEnabled")(function* (spec: string, enabled: boolean) {
      const current = yield* get()
      const target = yield* resolvePluginConfigTarget(spec, current)
      yield* Effect.promise(() => fsNode.mkdir(path.dirname(target), { recursive: true }))
      yield* updateConfigFile(target, { plugin_enabled: { [spec]: enabled } })
      if (path.dirname(target) === Global.Path.config) {
        yield* invalidateGlobal
      }
      yield* InstanceState.invalidate(state)
      return yield* get()
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      yield* fs
        .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
        .pipe(Effect.orDie)
      yield* Effect.promise(() => Instance.dispose())
    })

    const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
      yield* invalidateGlobal
      const task = Instance.disposeAll()
        .catch(() => undefined)
        .finally(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.Disposed.type,
              properties: {},
            },
          }),
        )
      if (wait) yield* Effect.promise(() => task)
      else void task
    })

    const invalidateModelSelection = Effect.fn("Config.invalidateModelSelection")(function* () {
      yield* invalidateGlobal
      yield* Effect.promise(() => Instance.invalidateAllCaches())
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Event.Disposed.type,
          properties: {},
        },
      })
    })

    const isModelSelectionPatchValue = (value: unknown): boolean => {
      if (value === null || value === undefined) return true
      if (typeof value === "string") return true
      if (!value || typeof value !== "object" || Array.isArray(value)) return false
      return Object.entries(value).every(([key, next]) => key === "model" && isModelSelectionPatchValue(next))
    }

    const isModelSelectionPatch = (patch: Patch) =>
      Object.entries(patch).every(([key, value]) => {
        if (key === "model" || key === "small_model") return isModelSelectionPatchValue(value)
        if (key !== "agent") return false
        if (!value || typeof value !== "object" || Array.isArray(value)) return false
        return Object.values(value).every((next) => isModelSelectionPatchValue(next))
      })

    const getGlobalPersonalization = Effect.fn("Config.getGlobalPersonalization")(function* () {
      const config = yield* getGlobal()
      const instructionFile = globalPersonalizationFile()
      const customInstructions = normalizePersonalizationText((yield* readOptionalFile(instructionFile)) ?? "")
      return {
        customInstructions,
        instructionFile,
        memory: {
          ccIndex: config.memory?.cc_index ?? false,
          autoConsolidation: config.dream?.auto ?? true,
        },
        maintenance: resolvePersonalizationMaintenance(config),
        config,
      }
    })

    const getGlobalAppControl = Effect.fn("Config.getGlobalAppControl")(function* () {
      const config = yield* getGlobal()
      const current = resolveGlobalAppControlConfig(config)
      const service = yield* Effect.promise(() => readGlobalAppControlService())
      return {
        enabled: current.enabled,
        permission: current.permission,
        target: "app" as const,
        availableTargets: ["app" as const],
        service,
        config,
      }
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Patch) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const nullPaths = collectNullPaths(config)
      const cleaned = stripNulls(config)

      let next: Info
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), cleaned as Record<string, unknown>)
        for (const item of nullPaths) {
          deleteObjectPath(merged as Record<string, unknown>, item)
        }
        yield* fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
        next = ConfigParse.schema(Info, merged, file)
      } else {
        let updated = patchJsonc(before, cleaned)
        for (const item of nullPaths) {
          updated = deleteJsoncPath(updated, item)
        }
        next = ConfigParse.schema(Info, ConfigParse.jsonc(updated, file), file)
        yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      if (isModelSelectionPatch(config)) {
        yield* invalidateModelSelection()
        return next
      }

      yield* invalidate()
      return next
    })

    const saveGlobalPersonalization = Effect.fn("Config.saveGlobalPersonalization")(function* (
      input: GlobalPersonalizationSave,
    ) {
      const managedPath = globalPersonalizationFile()
      const customInstructions = normalizePersonalizationText(input.customInstructions)
      const keepManagedInstructions = hasPersonalizationText(customInstructions)
      const current = yield* getGlobal()
      const nextInstructions = updateManagedInstructionPath(current.instructions, managedPath, keepManagedInstructions)
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const previousManaged = yield* readOptionalFile(managedPath)
      const patch = {
        instructions: nextInstructions,
        memory: {
          cc_index: input.memory.ccIndex,
        },
        dream: {
          auto: input.maintenance.dreamEnabled,
        },
        distill: {
          auto: input.maintenance.distillEnabled,
        },
        maintenance: {
          enabled: input.maintenance.enabled,
          scheduler_enabled: input.maintenance.schedulerEnabled,
          dream_enabled: input.maintenance.dreamEnabled,
          distill_enabled: input.maintenance.distillEnabled,
        },
      } satisfies Patch

      let updated = before
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), stripNulls(patch) as Record<string, unknown>)
        if (!nextInstructions) {
          delete merged.instructions
        }
        ConfigParse.schema(Info, merged, file)
        updated = JSON.stringify(merged, null, 2)
      } else {
        updated = patchJsonc(before, stripNulls(patch))
        if (!nextInstructions) {
          updated = deleteJsoncPath(updated, ["instructions"])
        }
        ConfigParse.schema(Info, ConfigParse.jsonc(updated, file), file)
      }

      const restoreManaged = () =>
        previousManaged === undefined
          ? Effect.promise(() => fsNode.unlink(managedPath).catch(() => {}))
          : writeFileAtomic(managedPath, previousManaged)

      if (keepManagedInstructions) {
        yield* writeFileAtomic(managedPath, customInstructions)
      }
      if (!keepManagedInstructions) {
        yield* Effect.promise(() => fsNode.unlink(managedPath).catch(() => {}))
      }

      try {
        yield* writeFileAtomic(file, updated)
      } catch (error) {
        yield* restoreManaged().pipe(Effect.catch(() => Effect.void))
        throw error
      }

      yield* invalidate(true)
      return yield* getGlobalPersonalization()
    })

    const saveGlobalAppControl = Effect.fn("Config.saveGlobalAppControl")(function* (input: GlobalAppControlSave) {
      const next = yield* updateGlobal({
        app_control: {
          enabled: input.enabled,
          permission: input.permission,
        },
      })
      const current = resolveGlobalAppControlConfig(next)
      const service = yield* Effect.promise(() => readGlobalAppControlService())
      return {
        enabled: current.enabled,
        permission: current.permission,
        target: "app" as const,
        availableTargets: ["app" as const],
        service,
        config: next,
      }
    })

    const globalProviderFile = Effect.fnUntraced(function* (providerID: string) {
      for (const file of globalConfigFiles()) {
        const before = yield* readConfigFile(file)
        if (!before) continue
        const config = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const provider = config.provider?.[providerID]
        if (!provider) continue
        return { file, before, config, provider }
      }

      throw new Error(`Provider ${providerID} is not configured in global config files`)
    })

    const removeGlobalCustomProvider = Effect.fn("Config.removeGlobalCustomProvider")(function* (providerID: string) {
      const target = yield* globalProviderFile(providerID)

      if (!isCustomProviderConfig(target.provider)) {
        throw new Error(`Provider ${providerID} is not a custom provider`)
      }

      const next = withoutGlobalCustomProvider(target.config, providerID)

      if (!target.file.endsWith(".jsonc")) {
        yield* fs.writeFileString(target.file, JSON.stringify(next, null, 2)).pipe(Effect.orDie)
        yield* authSvc.remove(providerID).pipe(Effect.catch(() => Effect.void))
        yield* invalidate()
        return next
      }

      let updated = deleteJsoncPath(target.before, ["provider", providerID])
      if (!next.provider) updated = deleteJsoncPath(updated, ["provider"])
      updated = next.disabled_providers
        ? patchJsonc(updated, { disabled_providers: next.disabled_providers })
        : deleteJsoncPath(updated, ["disabled_providers"])
      const parsed = ConfigParse.schema(Info, ConfigParse.jsonc(updated, target.file), target.file)
      yield* fs.writeFileString(target.file, updated).pipe(Effect.orDie)
      yield* authSvc.remove(providerID).pipe(Effect.catch(() => Effect.void))
      yield* invalidate()
      return parsed
    })

    const upsertGlobalCustomProvider = Effect.fn("Config.upsertGlobalCustomProvider")(function* (
      providerID: string,
      provider: ConfigProvider.Info,
      key?: string,
    ) {
      const target = yield* Effect.fn(function* () {
        for (const file of globalConfigFiles()) {
          const before = yield* readConfigFile(file)
          if (!before) continue
          const config = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
          const current = config.provider?.[providerID]
          if (!current) continue
          return { file, before, config, provider: current }
        }
        return {
          file: globalConfigFile(),
          before: undefined as string | undefined,
          config: undefined as Info | undefined,
          provider: undefined as ConfigProvider.Info | undefined,
        }
      })()

      if (target.provider && !isCustomProviderConfig(target.provider)) {
        throw new Error(`Provider ${providerID} is not a custom provider`)
      }

      const file = target.file
      const before = target.before ?? (yield* readConfigFile(file)) ?? "{}"
      const current = target.config ?? (yield* getGlobal())
      const next = withGlobalCustomProvider(current, providerID, provider)

      if (!file.endsWith(".jsonc")) {
        const existingConfig = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existingConfig), {
          provider: next.provider,
          disabled_providers: next.disabled_providers,
        })
        if (!next.provider) delete merged.provider
        if (!next.disabled_providers) delete merged.disabled_providers
        ConfigParse.schema(Info, merged, file)
        yield* fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
      } else {
        let updated = patchJsonc(before, {
          provider: {
            [providerID]: provider,
          },
          disabled_providers: next.disabled_providers,
        })
        if (!next.provider) updated = deleteJsoncPath(updated, ["provider"])
        if (!next.disabled_providers) updated = deleteJsoncPath(updated, ["disabled_providers"])
        ConfigParse.schema(Info, ConfigParse.jsonc(updated, file), file)
        yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      if (key) {
        yield* authSvc.set(providerID, {
          type: "api",
          key,
        }).pipe(Effect.orDie)
      }

      yield* invalidate()
      return yield* getGlobal()
    })

    return Service.of({
      get,
      getGlobal,
      getGlobalPersonalization,
      getGlobalAppControl,
      getConsoleState,
      update,
      updateGlobal,
      saveGlobalPersonalization,
      saveGlobalAppControl,
      upsertGlobalCustomProvider,
      removeGlobalCustomProvider,
      upsertMcp,
      removeMcp,
      updateMcpEnabled,
      updatePluginEnabled,
      invalidate,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)


