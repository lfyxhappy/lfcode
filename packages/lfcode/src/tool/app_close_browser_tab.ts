import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Browser session key. Defaults to the current session."),
})

export const AppCloseBrowserTabTool = Tool.define(
  "app_close_browser_tab",
  appBrowserTool(parameters, (app) => ({
    description: "Close the current side browser tab for a session.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.client("browser_control")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/close", {
            sessionKey,
          }),
        )
        return {
          title: "Closed side browser tab",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
          },
        }
      }),
  })),
)
