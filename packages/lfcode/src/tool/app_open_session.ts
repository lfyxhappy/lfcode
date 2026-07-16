import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  directory: z.string().describe("Absolute project directory that owns the target session."),
  session_id: z.string().describe("Session ID to open in the desktop app."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppOpenSessionTool = Tool.define(
  "app_open_session",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: "Open a specific session in the local Lfcode desktop app.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post("/session/open", {
              windowID: args.window_id,
              directory: args.directory,
              sessionID: args.session_id,
            }),
          )
          return {
            title: `Opened session ${args.session_id}`,
            output: JSON.stringify(result, null, 2),
            metadata: {
              sessionID: args.session_id,
              directory: args.directory,
            },
          }
        }),
    }
  }),
)
