import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  text: z.string().optional().describe("Wait until this text appears on the browser page."),
  text_gone: z.string().optional().describe("Wait until this text disappears from the browser page."),
  time_ms: z.number().int().positive().optional().describe("Optional extra in-browser wait duration."),
  timeout_ms: z.number().int().positive().optional().describe("Maximum wait time before timing out."),
  session_key: z.string().optional().describe("Browser session key. Defaults to the current session."),
})

export const AppBrowserWaitTool = Tool.define(
  "app_browser_wait",
  appBrowserTool(parameters, (app) => ({
    description: "Wait for text conditions or time-based settling inside the side browser.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.client("browser_control")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post<{ matched?: boolean }>("/browser/wait", {
            sessionKey,
            text: args.text,
            textGone: args.text_gone,
            timeMs: args.time_ms,
            timeoutMs: args.timeout_ms,
          }),
        )
        return {
          title: result?.matched ? "Browser wait matched" : "Browser wait timed out",
          output: JSON.stringify(result, null, 2),
          metadata: { sessionKey, matched: result?.matched === true },
        }
      }),
  })),
)
