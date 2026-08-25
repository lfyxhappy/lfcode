import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppGetStateTool = Tool.define(
  "app_get_state",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Read the current local Lfcode desktop application state through App Control, including route, active session, side panels, and composer target.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const query = args.window_id ? `?windowID=${args.window_id}` : ""
          const result = yield* Effect.promise(() => client.get(`/diagnostics/ui-state${query}`))
          return {
            title: "Read desktop app state",
            output: JSON.stringify(result, null, 2),
            metadata: {
              windowID: args.window_id,
            },
          }
        }),
    }
  }),
)
