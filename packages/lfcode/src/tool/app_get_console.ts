import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
  limit: z.number().int().positive().max(500).optional().describe("Maximum number of recent browser console entries to return."),
})

export const AppGetConsoleTool = Tool.define(
  "app_get_console",
  appBrowserTool(parameters, (app) => ({
    description: "Read recent side-browser console output for the current desktop session.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/console", {
            sessionKey,
            limit: args.limit,
          }),
        )
        return {
          title: "Read side browser console",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
            limit: args.limit,
          },
        }
      }),
  })),
)
