import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Goal } from "@/session/goal"

const parameters = z.object({
  objective: z.string().trim().min(1).describe("Long-running objective to track for the current session."),
})

type CreateGoalMetadata = {
  goal?: z.infer<typeof Goal.GoalState>
  rejected?: boolean
}

const explicitGoalIntentPatterns = [
  /\b\/goal\b/i,
  /\bgoal mode\b/i,
  /\bcreate goal\b/i,
  /\bset (?:a )?goal\b/i,
  /\benter goal mode\b/i,
  /进入\s*goal\s*模式/i,
  /设个\s*goal/i,
  /创建\s*goal/i,
]

const untilStyleGoalIntentPatterns = [
  /\bcontinue until\b/i,
  /\bkeep working until\b/i,
  /\bdon'?t stop until\b/i,
  /\bdo not stop until\b/i,
  /继续做直到/,
  /不要停直到/,
  /一直做直到/,
  /持续.*直到/,
]

function latestRealUserMessageText(messages: Tool.Context["messages"]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.info.role !== "user") continue
    const text = message.parts
      .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text.trim()] : []))
      .filter(Boolean)
      .join("\n")
      .trim()
    if (text) return text
  }
  return ""
}

function userExplicitlyRequestedGoal(messages: Tool.Context["messages"]) {
  const latest = latestRealUserMessageText(messages)
  if (!latest) return false
  return [...explicitGoalIntentPatterns, ...untilStyleGoalIntentPatterns].some((pattern) => pattern.test(latest))
}

export const CreateGoalTool = Tool.define(
  "create_goal",
  Effect.gen(function* () {
    const goal = yield* Goal.Service

    const definition: Tool.DefWithoutID<typeof parameters, CreateGoalMetadata> = {
      description:
        "Create or replace the current session goal for long-running work. Use this only when the user explicitly wants an ongoing goal tracked across turns.",
      parameters,
      execute: (input: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!userExplicitlyRequestedGoal(ctx.messages)) {
            return {
              title: "Goal creation rejected",
              output:
                "Goal mode can only be entered when the user's latest message explicitly asks for a goal or says to keep working until a condition is met. Use /goal or ask the user to state the stop condition directly.",
              metadata: { goal: undefined, rejected: true },
            }
          }
          const created = yield* goal.create(ctx.sessionID, input.objective)
          return {
            title: "Goal created",
            output: [`Status: ${created.status}`, `Objective: ${created.objective}`].join("\n"),
            metadata: { goal: created },
          }
        }),
    }
    return definition
  }),
)

export { parameters }
