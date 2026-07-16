import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Goal } from "@/session/goal"

type GetGoalMetadata = {
  goal?: z.infer<typeof Goal.GoalState>
}

export const GetGoalTool = Tool.define(
  "get_goal",
  Effect.gen(function* () {
    const goal = yield* Goal.Service

    const definition: Tool.DefWithoutID<z.ZodObject<{}>, GetGoalMetadata> = {
      description: "Get the current session goal state, including status, timestamps, and the latest verdict.",
      parameters: z.object({}),
      execute: (_input: Record<string, never>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* goal.get(ctx.sessionID)
          if (!current) {
            return {
              title: "No goal",
              output: "No session goal is currently set.",
              metadata: { goal: undefined },
            }
          }

          const lines = [
            `Status: ${current.status}`,
            `Objective: ${current.objective}`,
            `Created: ${new Date(current.time.created).toISOString()}`,
            `Updated: ${new Date(current.time.updated).toISOString()}`,
            `Blocked count: ${current.blockedCount}`,
          ]
          if (current.blockedReason) lines.push(`Blocked reason: ${current.blockedReason}`)
          if (current.lastVerdict) lines.push(`Last verdict: ${JSON.stringify(current.lastVerdict)}`)
          return {
            title: "Goal state",
            output: lines.join("\n"),
            metadata: { goal: current },
          }
        }),
    }
    return definition
  }),
)
