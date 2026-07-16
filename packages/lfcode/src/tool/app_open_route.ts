import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  route: z.string().min(1).describe("Hash route to open inside the local desktop app, such as /settings or /<dir>/session/<id>."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppOpenRouteTool = Tool.define(
  "app_open_route",
  appBrowserTool(parameters, (app) => ({
    description: "Navigate the local Lfcode desktop app to a specific in-app route.",
    execute: (args) =>
      Effect.gen(function* () {
        const client = yield* app.client("session_control")
        const result = yield* Effect.promise(() =>
          client.post("/route/navigate", {
            windowID: args.window_id,
            route: args.route,
          }),
        )
        return {
          title: "Opened desktop route",
          output: JSON.stringify(result, null, 2),
          metadata: {
            windowID: args.window_id,
            route: args.route,
          },
        }
      }),
  })),
)
