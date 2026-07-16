import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  text: z.string().describe("Text to place into the desktop app composer."),
  target: z
    .enum(["main", "active_side"])
    .optional()
    .describe("Where to write text. Use active_side for the currently active side chat tab."),
  session_id: z
    .string()
    .optional()
    .describe("Explicit side chat session ID. When provided, it overrides target and writes to that side chat."),
  append: z.boolean().optional().describe("Append to existing composer text instead of replacing it."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppSetInputTool = Tool.define(
  "app_set_input",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: "Set or append text in the local Lfcode desktop app composer.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post("/composer/set-text", {
              windowID: args.window_id,
              text: args.text,
              target: args.target === "active_side" ? "active-side" : "main",
              sessionID: args.session_id,
              append: args.append === true,
            }),
          )
          return {
            title: "Updated app composer input",
            output: JSON.stringify(result, null, 2),
            metadata: {},
          }
        }),
    }
  }),
)
