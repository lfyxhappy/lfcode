import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z
  .object({
    session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
    ref: z.string().optional().describe("Optional stable reference returned by prior browser reads or snapshots."),
    selector: z.string().optional().describe("Optional CSS selector used when no ref is available."),
  })
  .refine((value) => !!value.ref || !!value.selector, {
    message: "Either ref or selector is required.",
    path: ["ref"],
  })

export const AppBrowserExtractResourceTool = Tool.define(
  "app_browser_extract_resource",
  appBrowserTool(parameters, (app) => ({
    description: "Extract the resolved resource metadata and contents behind a browser element such as an image, audio, or video node.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.client("browser_control")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/extract-resource", {
            sessionKey,
            ref: args.ref,
            selector: args.selector,
          }),
        )
        return {
          title: "Extracted side browser resource",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
            ref: args.ref,
            selector: args.selector,
          },
        }
      }),
  })),
)
