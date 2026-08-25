import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Browser session key. Defaults to the current session."),
})

export const AppReadBrowserPageTool = Tool.define(
  "app_read_browser_page",
  appBrowserTool(parameters, (app) => ({
    description: "Read the current side browser page, including URL, title, text snapshot, and resource summary.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/read-page", {
            sessionKey,
          }),
        )
        return {
          title: "Read side browser page",
          output: JSON.stringify(result, null, 2),
          metadata: { sessionKey },
        }
      }),
  })),
)
