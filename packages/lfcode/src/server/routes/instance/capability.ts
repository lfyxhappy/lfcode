import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { CapabilityPersistence } from "@/capability/persistence"
import { decideCapabilityOperation } from "@/capability/gate"
import { disableCapability, stopCapabilityWork } from "@/capability/control"
import { filterCapabilities, localSkillCapability, toolCapability, type CapabilityCatalogEntry, type CapabilityKind } from "@/capability/catalog"
import { type CapabilityOperation, type CapabilityRisk, type CapabilitySource } from "@/capability/policy"
import { getRuntimeManageState } from "@/runtime-registry"
import { listInstalledPlugins } from "@/plugin/library"
import { MCP } from "@/mcp"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool"
import { errors } from "../../error"
import { NotFoundError } from "@/storage"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const CapabilityRisk = z.enum(["read", "modify", "install", "credential", "destructive", "release"])
const CapabilitySource = z.enum(["core", "official", "local", "public", "plugin", "mcp", "runtime"])
const CapabilityOperation = z.enum(["read", "execute", "stop", "install", "update", "enable", "disable", "delete", "export", "publish"])
const CapabilityKind = z.enum(["tool", "skill", "plugin", "mcp", "runtime"])
const CapabilityHealth = z.enum(["ready", "disabled", "degraded", "missing"])
const CapabilityAuthentication = z.enum(["not_required", "available", "required", "unknown"])

const CapabilityCatalogEntry = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    kind: CapabilityKind,
    source: CapabilitySource,
    risk: CapabilityRisk,
    scope: z.enum(["global", "project"]),
    health: CapabilityHealth,
    authentication: CapabilityAuthentication,
    dependencies: z.array(z.string()),
    foreground: z.boolean(),
    background: z.boolean(),
    subagent: z.boolean(),
    reversible: z.boolean(),
  })
  .meta({ ref: "CapabilityCatalogEntry" })

const CapabilityGrant = z
  .object({
    id: z.string(),
    capability: z.string(),
    scope: z.string(),
    source: CapabilitySource,
    expiresAt: z.number().int().optional(),
    remainingBudget: z.number().int().nonnegative().optional(),
    revoked: z.boolean().optional(),
  })
  .meta({ ref: "CapabilityGrant" })

const CapabilityAudit = z
  .object({
    id: z.string(),
    caller: z.string(),
    capability: z.string(),
    operation: CapabilityOperation,
    decision: z.enum(["allow", "preview", "confirm", "deny"]),
    target: z.string().optional(),
    projectID: z.string().optional(),
    sessionID: z.string().optional(),
    messageID: z.string().optional(),
    reason: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    result: z.string().optional(),
    rollback: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .meta({ ref: "CapabilityAudit" })

const PolicyDecisionInput = z.object({
  auditID: z.string().min(1),
  caller: z.string().min(1),
  capability: z.string().min(1),
  risk: CapabilityRisk,
  source: CapabilitySource,
  operation: CapabilityOperation,
  previewed: z.boolean(),
  reversible: z.boolean(),
  grantID: z.string().min(1).optional(),
  target: z.string().optional(),
  projectID: z.string().optional(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const StopInput = z
  .object({
    scope: z.enum(["global", "project", "session"]),
    projectID: z.string().min(1).optional(),
    sessionID: z.string().min(1).optional(),
    caller: z.string().min(1),
    reason: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "project" && !value.projectID) {
      ctx.addIssue({ code: "custom", path: ["projectID"], message: "projectID is required for project stop" })
    }
    if (value.scope === "session" && !value.sessionID) {
      ctx.addIssue({ code: "custom", path: ["sessionID"], message: "sessionID is required for session stop" })
    }
  })

const StopResult = z
  .object({
    scope: z.enum(["global", "project", "session"]),
    sessions: z.array(z.object({ id: z.string(), projectID: z.string(), status: z.enum(["requested", "skipped", "failed"]), error: z.string().optional() })),
    jobs: z.array(z.object({ id: z.string(), status: z.enum(["cancelled", "unchanged", "failed"]), error: z.string().optional() })),
  })
  .meta({ ref: "CapabilityStopResult" })

function pluginCapability(input: Awaited<ReturnType<typeof listInstalledPlugins>>[number]): CapabilityCatalogEntry {
  return {
    id: `plugin:${input.id}`,
    title: input.name,
    description: input.description,
    kind: "plugin",
    source: input.trust === "official" || input.trust === "bundled" ? "official" : "plugin",
    risk: "install",
    scope: "global",
    health: input.enabled ? "ready" : "disabled",
    authentication: "not_required",
    dependencies: input.dependencies.map((item) => item.name),
    foreground: true,
    background: false,
    subagent: true,
    reversible: true,
  }
}

function runtimeCapabilities(state: Awaited<ReturnType<typeof getRuntimeManageState>>): CapabilityCatalogEntry[] {
  return state.items.map((item) => ({
    id: `runtime:${item.id}`,
    title: item.title,
    description: item.description,
    kind: "runtime",
    source: "runtime",
    risk: "install",
    scope: "global",
    health: item.installed ? "ready" : "missing",
    authentication: "not_required",
    dependencies: item.usedBy,
    foreground: true,
    background: true,
    subagent: true,
    reversible: item.actions.activate,
  }))
}

function mcpCapabilities(status: Record<string, { status: string }>): CapabilityCatalogEntry[] {
  return Object.entries(status).map(([name, item]) => ({
    id: `mcp:${name}`,
    title: name,
    description: `MCP server status: ${item.status}`,
    kind: "mcp",
    source: "mcp",
    risk: "install",
    scope: "project",
    health: item.status === "connected" ? "ready" : item.status === "disabled" ? "disabled" : "degraded",
    authentication: item.status === "needs_auth" ? "required" : "not_required",
    dependencies: [],
    foreground: true,
    background: true,
    subagent: true,
    reversible: true,
  }))
}

function catalog(input: {
  tools: Parameters<typeof toolCapability>[0][]
  skills: Parameters<typeof localSkillCapability>[0][]
  plugins: Awaited<ReturnType<typeof listInstalledPlugins>>
  runtimes: Awaited<ReturnType<typeof getRuntimeManageState>>
  mcp: Record<string, { status: string }>
}) {
  return [
    ...input.tools.map(toolCapability),
    ...input.skills.map(localSkillCapability),
    ...input.plugins.map(pluginCapability),
    ...runtimeCapabilities(input.runtimes),
    ...mcpCapabilities(input.mcp),
  ]
}

function capabilityCatalog() {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const [tools, skills, plugins, runtimes, mcpStatus] = yield* Effect.all([
      registry.all(),
      skill.all(),
      Effect.promise(listInstalledPlugins),
      Effect.promise(getRuntimeManageState),
      mcp.status(),
    ])
    return catalog({ tools, skills, plugins, runtimes, mcp: mcpStatus })
  })
}

export const CapabilityRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List Agent OS capabilities",
        description: "List tools, skills, plugins, MCP servers, and runtimes through one capability catalog.",
        operationId: "capability.list",
        responses: { 200: { description: "Capabilities", content: { "application/json": { schema: resolver(CapabilityCatalogEntry.array()) } } }, ...errors(400) },
      }),
      validator("query", z.object({ q: z.string().optional(), kind: CapabilityKind.optional() })),
      async (c) =>
        jsonRequest("CapabilityRoutes.list", c, function* () {
          const query = c.req.valid("query")
          return filterCapabilities(yield* capabilityCatalog(), query.q, query.kind as CapabilityKind | undefined)
        }),
    )
    .get(
      "/grant",
      describeRoute({
        summary: "List capability grants",
        operationId: "capability.grant.list",
        responses: { 200: { description: "Capability grants", content: { "application/json": { schema: resolver(CapabilityGrant.array()) } } } },
      }),
      validator("query", z.object({ capability: z.string().optional(), activeOnly: z.coerce.boolean().optional() })),
      async (c) => c.json(CapabilityPersistence.listGrants(c.req.valid("query"))),
    )
    .post(
      "/grant",
      describeRoute({
        summary: "Save a capability grant",
        operationId: "capability.grant.save",
        responses: { 200: { description: "Capability grant", content: { "application/json": { schema: resolver(CapabilityGrant) } } }, ...errors(400) },
      }),
      validator("json", CapabilityGrant),
      async (c) => c.json(CapabilityPersistence.saveGrant(c.req.valid("json"))),
    )
    .post(
      "/grant/:grantID/revoke",
      describeRoute({
        summary: "Revoke a capability grant",
        operationId: "capability.grant.revoke",
        responses: { 200: { description: "Revoked capability grant", content: { "application/json": { schema: resolver(CapabilityGrant) } } }, ...errors(404) },
      }),
      validator("param", z.object({ grantID: z.string().min(1) })),
      async (c) => {
        const grant = CapabilityPersistence.revokeGrant(c.req.valid("param").grantID)
        if (!grant) throw new NotFoundError({ message: "Capability grant not found" })
        return c.json(grant)
      },
    )
    .post(
      "/disable",
      describeRoute({
        summary: "Disable an Agent OS capability",
        description: "Adds a durable revoke sentinel so future matching capability decisions are denied until a newer grant is saved.",
        operationId: "capability.disable",
        responses: { 200: { description: "Capability disable grant", content: { "application/json": { schema: resolver(CapabilityGrant) } } }, ...errors(400) },
      }),
      validator("json", z.object({ capability: z.string().min(1), caller: z.string().min(1), scope: z.string().min(1).optional(), reason: z.string().optional() })),
      async (c) => c.json(disableCapability(c.req.valid("json"))),
    )
    .post(
      "/stop",
      describeRoute({
        summary: "Stop Agent OS work",
        description: "Stops active loaded sessions and cancels durable background jobs in a session, project, or all projects without booting inactive projects.",
        operationId: "capability.stop",
        responses: { 200: { description: "Stop result", content: { "application/json": { schema: resolver(StopResult) } } }, ...errors(400) },
      }),
      validator("json", StopInput),
      async (c) => c.json(await stopCapabilityWork(c.req.valid("json") as never)),
    )
    .get(
      "/audit",
      describeRoute({
        summary: "List capability audit events",
        operationId: "capability.audit.list",
        responses: { 200: { description: "Capability audit events", content: { "application/json": { schema: resolver(CapabilityAudit.array()) } } } },
      }),
      validator("query", z.object({ capability: z.string().optional(), sessionID: z.string().optional(), projectID: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() })),
      async (c) => c.json(CapabilityPersistence.listAudit(c.req.valid("query"))),
    )
    .post(
      "/decision",
      describeRoute({
        summary: "Evaluate and audit a capability operation",
        description: "Records the policy decision before a management operation runs; callers execute only allow decisions.",
        operationId: "capability.decision",
        responses: { 200: { description: "Policy decision and audit event", content: { "application/json": { schema: resolver(z.object({ decision: z.enum(["allow", "preview", "confirm", "deny"]), audit: CapabilityAudit })) } } }, ...errors(400) },
      }),
      validator("json", PolicyDecisionInput),
      async (c) => {
        const input = c.req.valid("json")
        const gate = decideCapabilityOperation({
          auditID: input.auditID,
          caller: input.caller,
          capability: input.capability,
          risk: input.risk as CapabilityRisk,
          source: input.source as CapabilitySource,
          operation: input.operation as CapabilityOperation,
          previewed: input.previewed,
          reversible: input.reversible,
          grantID: input.grantID,
          target: input.target,
          projectID: input.projectID,
          sessionID: input.sessionID,
          messageID: input.messageID,
          reason: input.reason,
          metadata: input.metadata,
        })
        return c.json({
          decision: gate.decision,
          audit: CapabilityPersistence.completeAudit({ id: gate.auditID, result: `decision:${gate.decision}` })!,
        })
      },
    )
    .get(
      "/:capabilityID",
      describeRoute({
        summary: "Get Agent OS capability",
        operationId: "capability.get",
        responses: { 200: { description: "Capability", content: { "application/json": { schema: resolver(CapabilityCatalogEntry) } } }, ...errors(404) },
      }),
      validator("param", z.object({ capabilityID: z.string().min(1) })),
      async (c) =>
        jsonRequest("CapabilityRoutes.get", c, function* () {
          const entry = (yield* capabilityCatalog()).find((item) => item.id === c.req.valid("param").capabilityID)
          if (!entry) throw new NotFoundError({ message: "Capability not found" })
          return entry
        }),
    ),
)
