import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  target: z
    .enum(["main", "active_side"])
    .optional()
    .describe("Where to submit from. Use active_side for the currently active side chat tab."),
  session_id: z
    .string()
    .optional()
    .describe("Explicit side chat session ID. When provided, it overrides target and submits that side chat form."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppSendTool = Tool.define(
  "app_send",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: "Submit the current composer form in the local Lfcode desktop app.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post("/composer/submit", {
              windowID: args.window_id,
              target: args.target === "active_side" ? "active-side" : "main",
              sessionID: args.session_id,
            }),
          )
          return {
            title: "Submitted app composer",
            output: JSON.stringify(result, null, 2),
            metadata: {},
          }
        }),
    }
  }),
)
