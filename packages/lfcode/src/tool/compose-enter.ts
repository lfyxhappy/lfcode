import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider"
import { type SessionID, MessageID, PartID } from "../session/schema"
import DESCRIPTION from "./compose-enter.txt"

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID, { agentID: "*" })) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

export const ComposeEnterTool = Tool.define(
  "compose_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        reason: z.string().min(1).describe("Short reason this request should move to compose mode."),
      }),
      execute: (params: { reason: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* session.get(ctx.sessionID)
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                key: "compose_enter",
                params: { reason: params.reason },
                question: `This request looks better suited for compose mode: ${params.reason}. Switch to compose and continue with the large-project workflow?`,
                header: "Compose",
                options: [
                  { label: "Yes", description: "Switch to compose and use the large-project workflow" },
                  { label: "No", description: "Stay in build mode and continue directly" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const answer = answers[0]?.[0]
          if (answer === "No") return yield* new Question.RejectedError()

          if (answer !== "Yes") {
            return {
              title: "User provided feedback",
              output: `User chose not to switch yet and provided feedback: ${answer}`,
              metadata: { switched: false, feedback: answer },
            }
          }

          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "compose",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `Switch to compose mode and continue using the large-project workflow. Reason: ${params.reason}`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Switching to compose agent",
            output: "User approved switching to compose agent. Wait for further instructions.",
            metadata: { switched: true, feedback: "" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
