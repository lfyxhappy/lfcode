import z from "zod"
import { Effect } from "effect"
import { disableCapability, stopCapabilityWork } from "@/capability/control"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { CapabilityPersistence } from "@/capability/persistence"
import { type CapabilityScope, type CapabilitySource } from "@/capability/policy"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list_grants", "list_audit", "save_grant", "revoke_grant", "disable", "stop"]),
  capability: z.string().min(1).optional(),
  grant_id: z.string().min(1).optional(),
  scope: z.enum(["global", "project", "session"]).optional(),
  project_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  source: z.enum(["core", "official", "local", "public", "plugin", "mcp", "runtime"]).optional(),
  expires_at: z.number().int().positive().optional(),
  remaining_budget: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).describe("Short reason for this Agent OS capability control action."),
})

export const CapabilityManageTool = Tool.define(
  "capability_manage",
  Effect.succeed({
    description:
      "Inspect Agent OS grants and audit records; save or revoke grants; disable a capability; or stop active work for a session, project, or all loaded projects. Mutations are audited and require confirmation.",
    parameters: Parameters,
    execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        validate(params)
        const mutation = !["list_grants", "list_audit"].includes(params.action)
          const gate = decideCapabilityOperation({
          caller: "tool:capability_manage",
          capability: "agent_os",
          risk: ["save_grant", "revoke_grant", "disable"].includes(params.action)
            ? "destructive"
            : mutation
              ? "modify"
              : "read",
          source: "core",
          operation: mutation ? (params.action === "stop" ? "stop" : params.action === "disable" || params.action === "revoke_grant" ? "disable" : "update") : "read",
          previewed: true,
          reversible: params.action !== "disable",
          target: params.capability ?? params.grant_id ?? grantScope(params) ?? "agent-os",
          projectID: params.project_id,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          reason: params.reason,
        })
        requireCapabilityDecision(gate.decision)
        if (gate.decision === "confirm") {
          yield* ctx.ask({
            permission: "edit",
            patterns: [`agent-os:${params.action}:${params.capability ?? params.grant_id ?? params.scope ?? "global"}`],
            always: [],
            metadata: { agent_os_action: params.action, capability: params.capability },
          })
        }

        if (params.action === "list_grants") {
          const grants = CapabilityPersistence.listGrants({ capability: params.capability, activeOnly: false })
          completeCapabilityOperation(gate.auditID, `completed (${grants.length} grants)`)
          return result(params.reason, grants)
        }
        if (params.action === "list_audit") {
          const audit = CapabilityPersistence.listAudit({ capability: params.capability, projectID: params.project_id, sessionID: params.session_id })
          completeCapabilityOperation(gate.auditID, `completed (${audit.length} events)`)
          return result(params.reason, audit)
        }
        if (params.action === "save_grant") {
          const grant = CapabilityPersistence.saveGrant({
            id: params.grant_id!,
            capability: params.capability!,
            scope: grantScope(params)!,
            source: params.source as CapabilitySource,
            ...(params.expires_at === undefined ? {} : { expiresAt: params.expires_at }),
            ...(params.remaining_budget === undefined ? {} : { remainingBudget: params.remaining_budget }),
          })
          completeCapabilityOperation(gate.auditID, "completed", { action: "revoke_grant", grantID: grant.id })
          return result(params.reason, grant)
        }
        if (params.action === "revoke_grant") {
          const grant = CapabilityPersistence.revokeGrant(params.grant_id!)
          if (!grant) throw new Error(`Capability grant not found: ${params.grant_id}`)
          completeCapabilityOperation(gate.auditID, "completed")
          return result(params.reason, grant)
        }
        if (params.action === "disable") {
          const grant = disableCapability({ capability: params.capability!, caller: "tool:capability_manage", scope: params.scope, reason: params.reason })
          completeCapabilityOperation(gate.auditID, "completed")
          return result(params.reason, grant)
        }

        const stopped = yield* Effect.promise(() =>
          stopCapabilityWork(
            params.scope === "global"
              ? { scope: "global", caller: "tool:capability_manage", reason: params.reason }
              : params.scope === "project"
                ? { scope: "project", projectID: params.project_id!, caller: "tool:capability_manage", reason: params.reason }
                : { scope: "session", sessionID: params.session_id!, caller: "tool:capability_manage", reason: params.reason },
          ),
        )
        completeCapabilityOperation(gate.auditID, `completed (${stopped.sessions.length} sessions, ${stopped.jobs.length} jobs)`)
        return result(params.reason, stopped)
      }).pipe(Effect.orDie),
  }),
)

function validate(params: z.infer<typeof Parameters>) {
  if (["save_grant", "disable"].includes(params.action) && !params.capability) {
    throw new Error(`capability_manage ${params.action} requires capability`)
  }
  if (params.action === "save_grant" && (!params.grant_id || !params.scope || !params.source)) {
    throw new Error("capability_manage save_grant requires grant_id, scope, and source")
  }
  if (params.action === "save_grant" && params.scope === "project" && !params.project_id) {
    throw new Error("capability_manage save_grant scope=project requires project_id")
  }
  if (params.action === "save_grant" && params.scope === "session" && !params.session_id) {
    throw new Error("capability_manage save_grant scope=session requires session_id")
  }
  if (params.action === "revoke_grant" && !params.grant_id) throw new Error("capability_manage revoke_grant requires grant_id")
  if (params.action !== "stop") return
  if (!params.scope) throw new Error("capability_manage stop requires scope")
  if (params.scope === "project" && !params.project_id) throw new Error("capability_manage stop scope=project requires project_id")
  if (params.scope === "session" && !params.session_id) throw new Error("capability_manage stop scope=session requires session_id")
}

function grantScope(params: z.infer<typeof Parameters>): CapabilityScope | undefined {
  if (!params.scope) return undefined
  if (params.scope === "global") return "global"
  if (params.scope === "project") return `project:${params.project_id!}`
  return `session:${params.session_id!}`
}

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
