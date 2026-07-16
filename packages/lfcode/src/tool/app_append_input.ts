import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  text: z.string().describe("Text to append into the desktop app composer."),
  target: z
    .enum(["main", "active_side"])
    .optional()
    .describe("Where to append text. Use active_side for the currently active side chat tab."),
  session_id: z
    .string()
    .optional()
    .describe("Explicit side chat session ID. When provided, it overrides target and appends to that side chat."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppAppendInputTool = Tool.define(
  "app_append_input",
  appBrowserTool(parameters, (app) => ({
    description: "Append text to the existing local Lfcode desktop app composer contents.",
    execute: (args) =>
      Effect.gen(function* () {
        const client = yield* app.client("session_control")
        const result = yield* Effect.promise(() =>
          client.post("/composer/set-text", {
            windowID: args.window_id,
            text: args.text,
            target: args.target === "active_side" ? "active-side" : "main",
            sessionID: args.session_id,
            append: true,
          }),
        )
        return {
          title: "Appended app composer input",
          output: JSON.stringify(result, null, 2),
          metadata: {
            windowID: args.window_id,
            sessionID: args.session_id,
            target: args.target ?? "main",
          },
        }
      }),
  })),
)
