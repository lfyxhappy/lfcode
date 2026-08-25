import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  ref: z.string().min(1).describe("Stable element ref returned by a browser read or snapshot."),
  text: z.string().describe("Text to type into the target element."),
  submit: z.boolean().optional().describe("Whether to submit after typing."),
  session_key: z.string().optional().describe("Browser session key. Defaults to the current session."),
})

export const AppBrowserTypeTool = Tool.define(
  "app_browser_type",
  appBrowserTool(parameters, (app) => ({
    description: "Type into a side browser element by its stable ref.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("interactive")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/type", {
            sessionKey,
            ref: args.ref,
            text: args.text,
            submit: args.submit === true,
          }),
        )
        return {
          title: "Typed in side browser element",
          output: JSON.stringify(result, null, 2),
          metadata: { sessionKey, ref: args.ref },
        }
      }),
  })),
)
