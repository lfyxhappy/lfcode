import z from "zod"
import { Effect } from "effect"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { Instance } from "@/project/instance"
import { createHook, deleteHook, getHook, listHookRuns, listHooks, setHookEnabled, updateHook } from "@/hook/persistence"
import { executeHook } from "@/hook/runtime"
import { HookDefinitionInput, HookEvent } from "@/hook/schema"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "get", "create", "update", "enable", "disable", "delete", "test"]), id: z.string().optional(), definition: HookDefinitionInput.optional(),
  event: HookEvent.optional(), payload: z.record(z.string(), z.unknown()).optional(), reason: z.string().min(1).optional(),
}).superRefine((value, ctx) => { if (["get", "update", "enable", "disable", "delete", "test"].includes(value.action) && !value.id) ctx.addIssue({ code: "custom", path: ["id"], message: `${value.action} requires id` }); if (["create", "update"].includes(value.action) && !value.definition) ctx.addIssue({ code: "custom", path: ["definition"], message: `${value.action} requires definition` }) })

export const HookManageTool = Tool.define("hook_manage", Effect.succeed({
  description: "Manage declarative user Hooks. `get` returns the definition, recent runs, and lifecycle state. `test` records a simulated run but does not consume temporary Hook runs. Create temporary Hooks directly. Permanent Hook mutations present an explicit preview and require user confirmation.", parameters: Parameters,
  execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) => Effect.gen(function* () {
    const existing = params.id ? getHook(params.id) : undefined
    if (params.id && !existing) throw new Error(`Hook not found: ${params.id}`)
    const definition = params.definition
    const lifetime = definition?.lifetime ?? existing?.lifetime
    const mutating = params.action !== "list" && params.action !== "get" && params.action !== "test"
    const reason = params.reason ?? `${params.action} user Hook`
    const gate = decideCapabilityOperation({ caller: "tool:hook_manage", capability: "hook_manage", risk: mutating ? params.action === "delete" ? "destructive" : "modify" : "read", source: "local", operation: params.action === "delete" ? "delete" : params.action === "enable" ? "enable" : params.action === "disable" ? "disable" : mutating ? "update" : "read", previewed: true, reversible: params.action !== "delete", target: existing?.name ?? definition?.name, projectID: String(Instance.project.id), sessionID: ctx.sessionID, reason, metadata: { action: params.action, lifetime } })
    requireCapabilityDecision(gate.decision)
    if (mutating && lifetime === "permanent") yield* ctx.ask({ permission: "edit", patterns: [`hook:${params.action}:${existing?.name ?? definition?.name ?? "new"}`], always: [], metadata: { hook_action: params.action, preview: definition ?? existing } })
    const result = yield* Effect.promise(async () => {
      if (params.action === "list") return listHooks({ projectID: String(Instance.project.id), sessionID: ctx.sessionID, includeExpired: true })
      if (params.action === "get") return {
        hook: existing,
        recentRuns: listHookRuns({ hookID: existing!.id, limit: 5 }),
        lifecycle: {
          enabled: existing!.enabled,
          remainingRuns: existing!.remainingRuns,
          expiredAt: existing!.expiredAt,
          testConsumesRuns: false,
        },
      }
      if (params.action === "create") return createHook({ ...definition!, projectID: definition!.scope === "project" ? definition!.projectID ?? String(Instance.project.id) : definition!.projectID, sessionID: definition!.scope === "session" ? definition!.sessionID ?? ctx.sessionID : definition!.sessionID, ownerSessionID: definition!.ownerSessionID ?? ctx.sessionID, source: "model" })
      if (params.action === "update") return updateHook(params.id!, definition!)
      if (params.action === "enable" || params.action === "disable") return setHookEnabled(params.id!, params.action === "enable")
      if (params.action === "delete") return { deleted: deleteHook(params.id!) }
      const hook = existing!; const event = params.event ?? hook.events[0]!; const executed = await executeHook(hook, { event, sessionID: ctx.sessionID, projectID: String(Instance.project.id), cwd: Instance.worktree, payload: params.payload }); return { test: executed.run, blocked: executed.blocked, recentRuns: listHookRuns({ hookID: hook.id, limit: 5 }) }
    })
    completeCapabilityOperation(gate.auditID, "completed", mutating ? { action: params.action, hookID: existing?.id } : undefined)
    return { title: `Hook ${params.action}`, output: JSON.stringify(result, null, 2), metadata: {} }
  }).pipe(Effect.orDie),
}))
