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
  action: z.enum(["list", "create", "update", "delete"]),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional(),
  description: z.string().min(1).optional(),
  content: z.string().optional(),
  reason: z.string().min(1).optional().describe("Required short audit reason for every mutating Skill management action."),
}).superRefine((input, ctx) => {
  if (input.action === "list" || input.reason) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["reason"],
    message: `skill_manage ${input.action} requires a reason`,
  })
})

export const SkillManageTool = Tool.define(
  "skill_manage",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const skill = yield* Skill.Service
    return {
      description: "List, create, update, or delete Skills in the managed global Skill directory. Mutations are audited and require confirmation.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action !== "list" && !params.name) throw new Error(`skill_manage ${params.action} requires name`)
          if (params.action === "update" && !params.content && !params.description) throw new Error("skill_manage update requires content or description")
          const reason = params.reason ?? "List managed Skills"

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
                    : "update",
            previewed: true,
            reversible: params.action !== "delete",
            target: params.name,
            sessionID: ctx.sessionID,
            reason,
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
            return result(reason, items.map((item) => ({ name: item.name, description: item.description, location: item.location })))
          }

          const directory = path.join(globalSkillRoot(), params.name!)
          const file = path.join(directory, "SKILL.md")
          if (params.action === "create") {
            if (yield* fs.existsSafe(directory)) throw new Error(`Skill already exists: ${params.name}`)
            const parsed = params.content ? matter(params.content) : undefined
            const description = params.description ?? parsed?.data.description
            if (typeof description !== "string" || description.trim() === "") {
              throw new Error("skill_manage create requires description or valid SKILL.md frontmatter")
            }
            yield* fs.writeWithDirs(file, matter.stringify(parsed?.content || `# ${params.name}\n`, { name: params.name, description }))
            yield* skill.refresh()
            completeCapabilityOperation(gate.auditID, "completed", { action: "delete", skill: params.name })
            return result(reason, { created: params.name })
          }

          if (!(yield* fs.existsSafe(file))) throw new Error(`Managed Skill not found: ${params.name}`)
          if (params.action === "delete") {
            yield* fs.remove(directory, { recursive: true })
            yield* skill.refresh()
            completeCapabilityOperation(gate.auditID, "completed")
            return result(reason, { deleted: params.name })
          }

          const parsed = yield* Effect.promise(() => ConfigMarkdown.parse(file))
          const frontmatter = Skill.Frontmatter.parse({
            name: params.name,
            description: params.description ?? parsed.data.description,
          })
          yield* fs.writeWithDirs(file, matter.stringify(params.content ?? parsed.content, frontmatter))
          yield* skill.refresh()
          completeCapabilityOperation(gate.auditID, "completed")
          return result(reason, { updated: params.name })
        }).pipe(Effect.orDie),
    }
  }),
)

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
