import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  ref: z.string().min(1).describe("Stable element ref returned by a browser read or snapshot."),
  session_key: z.string().optional().describe("Browser session key. Defaults to the current session."),
})

export const AppBrowserClickTool = Tool.define(
  "app_browser_click",
  appBrowserTool(parameters, (app) => ({
    description: "Click an element in the side browser by its stable ref.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("interactive")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/click", {
            sessionKey,
            ref: args.ref,
          }),
        )
        return {
          title: "Clicked side browser element",
          output: JSON.stringify(result, null, 2),
          metadata: { sessionKey, ref: args.ref },
        }
      }),
  })),
)
