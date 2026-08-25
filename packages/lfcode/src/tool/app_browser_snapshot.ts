import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
})

export const AppBrowserSnapshotTool = Tool.define(
  "app_browser_snapshot",
  appBrowserTool(parameters, (app) => ({
    description: "Capture a structured DOM snapshot of the current side-browser page for stable follow-up actions.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/snapshot", {
            sessionKey,
          }),
        )
        return {
          title: "Captured side browser snapshot",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
          },
        }
      }),
  })),
)
