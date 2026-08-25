import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
  ref: z.string().optional().describe("Optional stable reference returned by prior browser reads or snapshots."),
  selector: z.string().optional().describe("Optional CSS selector used when no ref is available."),
  direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction."),
  amount: z.number().int().positive().optional().describe("Optional scroll amount in pixels."),
})

export const AppBrowserScrollTool = Tool.define(
  "app_browser_scroll",
  appBrowserTool(parameters, (app) => ({
    description: "Scroll the current side-browser page or a specific element within it.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("interactive")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/scroll", {
            sessionKey,
            ref: args.ref,
            selector: args.selector,
            direction: args.direction,
            amount: args.amount,
          }),
        )
        return {
          title: "Scrolled side browser",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
            direction: args.direction,
            amount: args.amount,
          },
        }
      }),
  })),
)
