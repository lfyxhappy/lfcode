import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
})

export const AppBrowserScreenshotTool = Tool.define(
  "app_browser_screenshot",
  appBrowserTool(parameters, (app) => ({
    description: "Capture a screenshot of the current side-browser page.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/screenshot", {
            sessionKey,
          }),
        )
        return {
          title: "Captured side browser screenshot",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
          },
        }
      }),
  })),
)
