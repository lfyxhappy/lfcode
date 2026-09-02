export * as ConfigAgent from "./agent"

import { Schema } from "effect"
import z from "zod"
import { Bus } from "@/bus"
import { zod, ZodOverride } from "@/util/effect-zod"
import { Log } from "../util"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { Glob } from "@lfcode-ai/shared/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "./error"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
import { ConfigPermission } from "./permission"

const log = Log.create({ service: "config" })

const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))

const DefaultExecution = Schema.Literals(["wait", "background"])
const DefaultContext = Schema.Literals(["minimal", "full", "task"])
const ModelInheritance = Schema.Literals(["primary", "configured"])

const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

// ConfigPermission.Info is a zod schema (its `.preprocess(...).transform(...)`
// shape lives outside the Effect Schema type system), so the walker reaches it
// via ZodOverride rather than a pure Schema reference.  This preserves the
// `$ref: PermissionConfig` emitted in openapi.json.
const PermissionRef = Schema.Any.annotate({ [ZodOverride]: ConfigPermission.Info })

const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(ConfigModelID).annotate({
      description:
        "Model for this agent: a literal provider/model (e.g. anthropic/claude-opus-4-8) or a tier/group name (e.g. ultra/standard/lite). Names without a '/' are resolved as model groups, provider-aware, at spawn time.",
    }),
    variant: Schema.optional(Schema.String).annotate({
      description: "Default model variant for this agent (applies only when using the agent's configured model).",
    }),
    temperature: Schema.optional(Schema.Number),
    top_p: Schema.optional(Schema.Number),
    prompt: Schema.optional(Schema.String),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
      description: "Removed. Configure canonical tool IDs through permission or tool_allowlist.",
    }),
    disable: Schema.optional(Schema.Boolean),
    description: Schema.optional(Schema.String).annotate({ description: "Description of when to use the agent" }),
    mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
    hidden: Schema.optional(Schema.Boolean).annotate({
      description: "Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)",
    }),
    preset: Schema.optional(Schema.String).annotate({
      description: "Optional native preset this agent was copied or overridden from.",
    }),
    display_name: Schema.optional(Schema.String).annotate({
      description: "Display name shown in subagent management and dispatch surfaces.",
    }),
    avatar: Schema.optional(Schema.String).annotate({
      description: "Stable avatar token shown for this agent.",
    }),
    icon: Schema.optional(Schema.String).annotate({
      description: "Stable icon token shown for this agent.",
    }),
    default_execution: Schema.optional(DefaultExecution).annotate({
      description: "Default dispatch behavior: wait for completion or run in the background.",
    }),
    default_context: Schema.optional(DefaultContext).annotate({
      description: "Default context policy: minimal checkpoint state, full conversation, or task only.",
    }),
    model_inheritance: Schema.optional(ModelInheritance).annotate({
      description: "Whether this agent inherits the primary model or uses an explicit configured model.",
    }),
    delegation_allowlist: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "Subagent role IDs this role may delegate to. Omit or leave empty to prohibit recursive delegation.",
    }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    color: Schema.optional(Color).annotate({
      description: "Hex color code (e.g., #FF5733) or theme color (e.g., primary)",
    }),
    steps: Schema.optional(PositiveInt).annotate({
      description: "Maximum number of agentic iterations before forcing text-only response",
    }),
    tool_allowlist: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "Optional list of tool IDs allowed for this agent. When set, only these tools are available.",
    }),
    maxSteps: Schema.optional(PositiveInt).annotate({ description: "@deprecated Use 'steps' field instead." }),
    permission: Schema.optional(PermissionRef),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

const KNOWN_KEYS = new Set([
  "name",
  "model",
  "variant",
  "prompt",
  "description",
  "temperature",
  "top_p",
  "mode",
  "hidden",
  "preset",
  "display_name",
  "avatar",
  "icon",
  "default_execution",
  "default_context",
  "model_inheritance",
  "delegation_allowlist",
  "color",
  "steps",
  "maxSteps",
  "options",
  "permission",
  "disable",
  "tools",
  "tool_allowlist",
])

const canonicalToolIDs = new Set([
  "read", "search", "edit", "shell", "browser", "app_control", "webfetch", "websearch",
  "skill", "memory", "task", "actor", "question", "create_goal", "get_goal", "update_goal",
])

// Promote unknown options and reject removed configuration surfaces. A deleted
// tool name must be fixed by the configuration author, never rewritten.
const normalize = (agent: z.infer<typeof Info>) => {
  if (agent.tools) throw new Error("agent.tools is removed; use permission or tool_allowlist with canonical tool IDs.")
  const removed = agent.tool_allowlist?.find((tool: string) => !canonicalToolIDs.has(tool))
  if (removed) throw new Error(`Unknown or removed tool '${removed}' in agent tool_allowlist.`)
  const options: Record<string, unknown> = { ...agent.options }
  for (const [key, value] of Object.entries(agent)) {
    if (!KNOWN_KEYS.has(key)) options[key] = value
  }

  const permission: ConfigPermission.Info = { ...agent.permission }

  return { ...agent, options, permission, steps: agent.steps ?? agent.maxSteps }
}

export const Info = zod(AgentSchema).transform(normalize).meta({ ref: "AgentConfig" }) as unknown as z.ZodType<
  Omit<z.infer<ReturnType<typeof zod<typeof AgentSchema>>>, "options" | "permission" | "steps"> & {
    options?: Record<string, unknown>
    permission?: ConfigPermission.Info
    steps?: number
  }
>
export type Info = z.infer<typeof Info>

export async function load(dir: string) {
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      const { Session } = await import("@/session")
      void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load agent", { agent: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.lfcode/agent/", "/.lfcode/agents/", "/agent/", "/agents/"]
    const name = configEntryNameFromPath(item, patterns)

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

export async function loadMode(dir: string) {
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse mode ${item}`
      const { Session } = await import("@/session")
      void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load mode", { mode: item, err })
      return undefined
    })
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(item, []),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.name] = {
        ...parsed.data,
        mode: "primary" as const,
      }
    }
  }
  return result
}
