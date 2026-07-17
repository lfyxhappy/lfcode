import path from "path"
import matter from "gray-matter"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import { ConfigMarkdown } from "@/config"
import { Skill } from "@/skill"
import { globalSkillRoot } from "@/skill/global-directory"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "create", "update", "set_hidden", "delete"]),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional(),
  description: z.string().min(1).optional(),
  content: z.string().optional(),
  hidden: z.boolean().optional(),
  reason: z.string().min(1).describe("Short reason for this Skill management action."),
})

export const SkillManageTool = Tool.define(
  "skill_manage",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const skill = yield* Skill.Service
    return {
      description: "List, create, update, hide, or delete Skills in the managed global Skill directory. Mutations are audited and require confirmation.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action !== "list" && !params.name) throw new Error(`skill_manage ${params.action} requires name`)
          if (params.action === "create" && !params.description) throw new Error("skill_manage create requires description")
          if (params.action === "update" && !params.content && !params.description) throw new Error("skill_manage update requires content or description")
          if (params.action === "set_hidden" && params.hidden === undefined) throw new Error("skill_manage set_hidden requires hidden")

          const gate = decideCapabilityOperation({
            caller: "tool:skill_manage",
            capability: "skill_manage",
            risk: params.action === "list" ? "read" : params.action === "delete" ? "destructive" : "modify",
            source: "local",
            operation:
              params.action === "list"
                ? "read"
                : params.action === "create"
                  ? "install"
                  : params.action === "delete"
                    ? "delete"
                    : params.action === "set_hidden"
                      ? params.hidden
                        ? "disable"
                        : "enable"
                      : "update",
            previewed: true,
            reversible: params.action !== "delete",
            target: params.name,
            sessionID: ctx.sessionID,
            reason: params.reason,
          })
          requireCapabilityDecision(gate.decision)
          if (gate.decision === "confirm") {
            yield* ctx.ask({
              permission: "edit",
              patterns: [`skill:${params.action}:${params.name ?? "managed"}`],
              always: [],
              metadata: { skill_action: params.action, skill_name: params.name },
            })
          }

          if (params.action === "list") {
            const items = yield* skill.all()
            completeCapabilityOperation(gate.auditID, `completed (${items.length} skills)`)
            return result(params.reason, items.map((item) => ({ name: item.name, description: item.description, location: item.location, hidden: item.hidden ?? false })))
          }

          const directory = path.join(globalSkillRoot(), params.name!)
          const file = path.join(directory, "SKILL.md")
          if (params.action === "create") {
            if (yield* fs.existsSafe(directory)) throw new Error(`Skill already exists: ${params.name}`)
            yield* fs.writeWithDirs(file, matter.stringify(params.content ?? `# ${params.name}\n`, { name: params.name, description: params.description }))
            yield* skill.refresh()
            completeCapabilityOperation(gate.auditID, "completed", { action: "delete", skill: params.name })
            return result(params.reason, { created: params.name })
          }

          if (!(yield* fs.existsSafe(file))) throw new Error(`Managed Skill not found: ${params.name}`)
          if (params.action === "delete") {
            yield* fs.remove(directory, { recursive: true })
            yield* skill.refresh()
            completeCapabilityOperation(gate.auditID, "completed")
            return result(params.reason, { deleted: params.name })
          }

          const parsed = yield* Effect.promise(() => ConfigMarkdown.parse(file))
          const data = { ...parsed.data } as Record<string, unknown>
          if (params.action === "set_hidden") {
            if (params.hidden) data.hidden = true
            else delete data.hidden
          }
          if (params.description) data.description = params.description
          yield* fs.writeWithDirs(file, matter.stringify(params.content ?? parsed.content, data))
          yield* skill.refresh()
          completeCapabilityOperation(gate.auditID, "completed")
          return result(params.reason, { updated: params.name, hidden: data.hidden === true })
        }).pipe(Effect.orDie),
    }
  }),
)

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
