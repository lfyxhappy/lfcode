import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Goal } from "@/session/goal"
import { Provider } from "@/provider"

const parameters = z
  .object({
    status: z.enum(["complete", "blocked"]).describe("Requested terminal state for the current session goal."),
    reason: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Required when status is blocked. Describe the exact repeated blocker."),
  })
  .superRefine((input, ctx) => {
    if (input.status === "blocked" && !input.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is required when status is blocked",
      })
    }
  })

type UpdateGoalMetadata = {
  goal?: z.infer<typeof Goal.GoalState>
  blocked?: boolean
  remaining?: number
  verdict?: z.infer<typeof Goal.GoalVerdict>
  completed?: boolean
}

function resolveModel(messages: Tool.Context["messages"]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const info = messages[index]?.info
    if (info?.role !== "user" || !info.model) continue
    return info.model
  }
  return undefined
}

export const UpdateGoalTool = Tool.define(
  "update_goal",
  Effect.gen(function* () {
    const goal = yield* Goal.Service
    const provider = yield* Provider.Service

    const definition: Tool.DefWithoutID<typeof parameters, UpdateGoalMetadata> = {
      description:
        "Request a terminal update for the current session goal. Use complete only when the objective is actually achieved; use blocked only after the same blocker has repeated.",
      parameters,
      execute: (input: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* goal.getActive(ctx.sessionID)
          if (!current) {
            return {
              title: "No active goal",
              output: "No active session goal is available to update.",
              metadata: { goal: undefined },
            }
          }

          if (input.status === "blocked") {
            const blocked = yield* goal.requestBlocked({
              sessionID: ctx.sessionID,
              reason: input.reason!,
            })
            return {
              title: blocked.blocked ? "Goal blocked" : "Goal still active",
              output: blocked.blocked
                ? `Goal marked blocked after ${blocked.goal?.blockedCount ?? 0} matching attempts.\nReason: ${input.reason}`
                : `Goal remains active. Matching blocked attempts remaining: ${blocked.remaining}\nReason: ${input.reason}`,
              metadata: {
                goal: blocked.goal,
                blocked: blocked.blocked,
                remaining: blocked.remaining,
              },
            }
          }

          const model = resolveModel(ctx.messages) ?? (yield* provider.defaultModel())
          const completed = yield* goal.requestComplete({
            sessionID: ctx.sessionID,
            msgs: ctx.messages,
            model,
            messageID: ctx.messageID,
          })
          return {
            title: completed.completed ? "Goal completed" : "Goal still active",
            output: completed.completed
              ? `Goal marked complete.${completed.verdict ? `\nJudge: ${completed.verdict.reason}` : ""}`
              : `Goal remains active.${completed.verdict ? `\nJudge: ${completed.verdict.reason}` : ""}`,
            metadata: {
              goal: completed.goal,
              verdict: completed.verdict,
              completed: completed.completed,
            },
          }
        }),
    }
    return definition
  }),
)

export { parameters }
