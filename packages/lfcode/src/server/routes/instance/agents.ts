import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"
import { Effect } from "effect"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Agent } from "@/agent/agent"
import { AgentPreset } from "@/agent/preset"
import { Config, ConfigAgent, ConfigMarkdown } from "@/config"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { NotFoundError } from "@/storage"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const AgentID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const Scope = z.enum(["global", "project"])
const ConfigRecord = z.record(z.string(), z.unknown())

const AgentManageParams = z.object({ id: AgentID })
const AgentManageDeleteQuery = z.object({ scope: Scope })
const AgentManagePut = z
  .object({
    scope: Scope,
    config: ConfigRecord,
    prompt: z.string().optional(),
  })
  .strict()

const AgentManageLayer = z
  .object({
    scope: Scope,
    path: z.string(),
    config: ConfigRecord,
    prompt: z.string(),
  })
  .meta({ ref: "AgentManageLayer" })

const AgentManageNativeLayer = z
  .object({
    scope: z.literal("native"),
    config: ConfigRecord,
    prompt: z.string(),
  })
  .meta({ ref: "AgentManageNativeLayer" })

const AgentManageEffective = z
  .object({
    name: z.string(),
    config: ConfigRecord,
    prompt: z.string(),
  })
  .nullable()
  .meta({ ref: "AgentManageEffective" })

const AgentManageItem = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    prompt: z.string(),
    config: ConfigRecord,
    native: AgentManageNativeLayer.nullable(),
    isNative: z.boolean(),
    global: AgentManageLayer.nullable(),
    project: AgentManageLayer.nullable(),
    effective: AgentManageEffective,
    source: z.enum(["native", "global", "project", "custom"]),
    origins: z.array(z.enum(["native", "global", "project"])),
    sources: z.array(
      z.object({
        scope: z.enum(["native", "global", "project"]),
        path: z.string().optional(),
      }),
    ),
    editable: z.object({
      global: z.literal(true),
      project: z.literal(true),
      delete: z.boolean(),
    }),
  })
  .meta({ ref: "AgentManageItem" })

const AgentManageResponse = z.object({ items: AgentManageItem.array() }).meta({ ref: "AgentManageResponse" })
const AgentManageMutation = z
  .object({
    id: z.string(),
    scope: Scope,
    restored: z.boolean(),
  })
  .meta({ ref: "AgentManageMutation" })

type Scope = z.infer<typeof Scope>
type Layer = {
  scope: Scope
  path: string
  config: Record<string, unknown>
  prompt: string
}

export const AgentManageRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List managed subagents",
        description: "List native subagent presets with their global, project, and effective configuration layers.",
        operationId: "agent.manage.list",
        responses: {
          200: {
            description: "Managed subagents",
            content: { "application/json": { schema: resolver(AgentManageResponse) } },
          },
          ...errors(400),
        },
      }),
      async (c) =>
        jsonRequest("AgentManageRoutes.list", c, function* () {
          const agents = yield* Agent.Service
          const [global, project] = yield* Effect.all([
            Effect.promise(() => readScope("global")),
            Effect.promise(() => readScope("project")),
          ])
          const ids = [...new Set([...AgentPreset.ids(), ...global.keys(), ...project.keys()])].sort()
          const items = yield* Effect.forEach(ids, (id) =>
            agents.get(id).pipe(
              Effect.map((effective) => itemFor(id, effective, global.get(id), project.get(id))),
            ),
          )
          return { items }
        }),
    )
    .put(
      "/:id",
      describeRoute({
        summary: "Save a subagent override",
        description: "Save a native override or a custom subagent in the requested global or project scope.",
        operationId: "agent.manage.put",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["scope", "config"],
                properties: {
                  scope: { enum: ["global", "project"] },
                  config: { type: "object", additionalProperties: true },
                  prompt: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Saved override",
            content: { "application/json": { schema: resolver(AgentManageMutation) } },
          },
          ...errors(400),
        },
      }),
      validator("param", AgentManageParams),
      validator("json", AgentManagePut),
      async (c) =>
        jsonRequest("AgentManageRoutes.put", c, function* () {
          const id = c.req.valid("param").id
          const input = c.req.valid("json")
          assertManagedID(id)
          const config = normalizeSaveConfig(id, input.config, input.prompt)
          yield* Effect.promise(() => writeScope(id, input.scope, config, input.prompt ?? ""))
          const configService = yield* Config.Service
          const agents = yield* Agent.Service
          yield* configService.invalidateAgentDefinitions()
          yield* agents.invalidate()
          return { id, scope: input.scope, restored: false }
        }),
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a subagent override",
        description: "Delete only the selected global or project override. Native presets remain available through inheritance.",
        operationId: "agent.manage.delete",
        responses: {
          200: {
            description: "Deleted override",
            content: { "application/json": { schema: resolver(AgentManageMutation) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", AgentManageParams),
      validator("query", AgentManageDeleteQuery),
      async (c) =>
        jsonRequest("AgentManageRoutes.delete", c, function* () {
          const id = c.req.valid("param").id
          const scope = c.req.valid("query").scope
          assertManagedID(id)
          yield* Effect.promise(() => deleteScope(id, scope))
          const configService = yield* Config.Service
          const agents = yield* Agent.Service
          yield* configService.invalidateAgentDefinitions()
          yield* agents.invalidate()
          return { id, scope, restored: AgentPreset.has(id) }
        }),
    ),
)

function itemFor(id: string, effective: Agent.Info | undefined, global: Layer | undefined, project: Layer | undefined) {
  const native = nativeLayer(id)
  const effectiveValue = effective
    ? {
        name: effective.name,
        config: configFromAgent(effective),
        prompt: effective.prompt ?? "",
      }
    : null
  const config = effectiveValue?.config ?? project?.config ?? global?.config ?? native?.config ?? { mode: "subagent" }
  const prompt = effectiveValue?.prompt ?? project?.prompt ?? global?.prompt ?? native?.prompt ?? ""
  const source = project ? "project" : global ? "global" : native ? "native" : "custom"
  const origins = [native ? "native" : undefined, global ? "global" : undefined, project ? "project" : undefined].filter(
    (value): value is "native" | Scope => !!value,
  )
  return {
    id,
    name: effective?.name ?? id,
    ...(typeof config.description === "string" ? { description: config.description } : {}),
    prompt,
    config,
    native,
    isNative: !!native,
    global: global ?? null,
    project: project ?? null,
    effective: effectiveValue,
    source,
    origins,
    sources: [
      ...(native ? [{ scope: "native" as const }] : []),
      ...(global ? [{ scope: "global" as const, path: global.path }] : []),
      ...(project ? [{ scope: "project" as const, path: project.path }] : []),
    ],
    editable: {
      global: true as const,
      project: true as const,
      delete: !!global || !!project,
    },
  }
}

function nativeLayer(id: string) {
  const preset = AgentPreset.get(id)
  if (!preset) return null
  return {
    scope: "native" as const,
    config: compact({
      mode: "subagent",
      preset: preset.id,
      display_name: preset.displayName,
      description: preset.description,
      avatar: preset.avatar,
      icon: preset.icon,
      color: preset.color,
      default_execution: preset.defaultExecution,
      default_context: preset.defaultContext,
      model_inheritance: preset.modelInheritance,
      delegation_allowlist: preset.delegationAllowlist,
      permission: preset.permission,
      tool_allowlist: preset.toolAllowlist,
    }),
    prompt: preset.prompt ?? "",
  }
}

function configFromAgent(agent: Agent.Info) {
  return compact({
    model: agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : agent.modelRef,
    variant: agent.variant,
    temperature: agent.temperature,
    top_p: agent.topP,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    preset: agent.preset,
    display_name: agent.displayName,
    avatar: agent.avatar,
    icon: agent.icon,
    default_execution: agent.defaultExecution,
    default_context: agent.defaultContext,
    model_inheritance: agent.modelInheritance,
    delegation_allowlist: agent.delegationAllowlist,
    color: agent.color,
    steps: agent.steps,
    tool_allowlist: agent.toolAllowlist,
    permission: agent.permission,
    options: Object.keys(agent.options).length ? agent.options : undefined,
  })
}

function compact(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function normalizeSaveConfig(id: string, input: Record<string, unknown>, prompt: string | undefined) {
  if ("name" in input || "prompt" in input) throw badRequest("Agent name and prompt must be set through the route path and prompt field")
  const config = compact(input)
  if (!AgentPreset.has(id)) {
    if (config.mode !== undefined && config.mode !== "subagent") throw badRequest("Custom agents must use subagent mode")
    config.mode ??= "subagent"
  }
  const parsed = ConfigAgent.Info.safeParse({ name: id, ...config, prompt: prompt ?? "" })
  if (parsed.success) return config
  const issue = parsed.error.issues[0]
  throw badRequest(`Invalid agent config${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}: ${issue?.message ?? "unknown error"}`)
}

async function readScope(scope: Scope) {
  const root = scopeRoot(scope)
  if (!(await inspectScopeDirectory(scope, root))) return new Map<string, Layer>()
  const entries = await fs.readdir(root, { withFileTypes: true })
  const layers = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const id = entry.name.slice(0, -3)
        if (!AgentID.safeParse(id).success || AgentPreset.reserved.has(id)) return
        const layer = await readLayer(id, scope)
        if (!layer) return
        return [id, layer] as const
      }),
  )
  return new Map(layers.filter((value): value is readonly [string, Layer] => !!value))
}

async function readLayer(id: string, scope: Scope) {
  const target = targetFor(id, scope)
  if (!(await inspectRegularFile(target))) return
  const parsed = await ConfigMarkdown.parse(target)
  const config = compact(parsed.data as Record<string, unknown>)
  const checked = ConfigAgent.Info.safeParse({ name: id, ...config, prompt: parsed.content.trim() })
  if (checked.success) {
    return {
      scope,
      path: target,
      config,
      prompt: parsed.content.trim(),
    }
  }
  const issue = checked.error.issues[0]
  throw badRequest(`Invalid ${scope} agent config for ${id}${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}`)
}

async function writeScope(id: string, scope: Scope, config: Record<string, unknown>, prompt: string) {
  const target = targetFor(id, scope)
  await ensureScopeDirectory(scope, path.dirname(target))
  await inspectRegularFile(target)
  const temporary = path.join(path.dirname(target), `.${id}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(temporary, matter.stringify(prompt, config))
  try {
    await fs.rename(temporary, target)
  } finally {
    await fs.unlink(temporary).catch(() => undefined)
  }
}

async function deleteScope(id: string, scope: Scope) {
  const target = targetFor(id, scope)
  if (!(await inspectScopeDirectory(scope, path.dirname(target)))) {
    throw new NotFoundError({ message: `Agent override not found: ${id}` })
  }
  if (!(await inspectRegularFile(target))) throw new NotFoundError({ message: `Agent override not found: ${id}` })
  await fs.unlink(target)
}

function targetFor(id: string, scope: Scope) {
  const root = scopeRoot(scope)
  const target = path.resolve(root, `${id}.md`)
  if (path.dirname(target) === root) return target
  throw badRequest("Agent ID escapes the configured directory")
}

function scopeRoot(scope: Scope) {
  if (scope === "global") return path.resolve(Global.Path.config, "agent")
  const worktree = Instance.worktree
  const project = worktree === path.parse(worktree).root ? Instance.directory : worktree
  return path.resolve(project, ".lfcode", "agent")
}

async function ensureScopeDirectory(scope: Scope, root: string) {
  const parent = path.dirname(root)
  if (!(await inspectDirectory(parent))) await fs.mkdir(parent, { recursive: true })
  if (!(await inspectDirectory(parent))) throw badRequest(`Agent ${scope} parent is not a directory`)
  if (!(await inspectDirectory(root))) await fs.mkdir(root, { recursive: false })
  if (!(await inspectDirectory(root))) throw badRequest(`Agent ${scope} directory is not a directory`)
}

async function inspectScopeDirectory(scope: Scope, root: string) {
  const parent = path.dirname(root)
  if (!(await inspectDirectory(parent))) return false
  if (!(await inspectDirectory(root))) return false
  return true
}

async function inspectDirectory(target: string) {
  const stat = await lstat(target)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw badRequest(`Symbolic links are not allowed in agent configuration paths: ${target}`)
  if (stat.isDirectory()) return true
  throw badRequest(`Agent configuration path is not a directory: ${target}`)
}

async function inspectRegularFile(target: string) {
  const stat = await lstat(target)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw badRequest(`Symbolic links are not allowed for agent configuration: ${target}`)
  if (stat.isFile()) return true
  throw badRequest(`Agent configuration target is not a file: ${target}`)
}

async function lstat(target: string) {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function assertManagedID(id: string) {
  if (!AgentPreset.reserved.has(id)) return
  throw badRequest(`Agent ${id} is reserved for internal use`)
}

function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message })
}
