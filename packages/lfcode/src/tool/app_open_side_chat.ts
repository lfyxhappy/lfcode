import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  text: z.string().optional().describe("Optional initial text to seed into the new side chat."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppOpenSideChatTool = Tool.define(
  "app_open_side_chat",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: "Create and open a new side chat in the local Lfcode desktop app.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post("/sidechat/create", {
              windowID: args.window_id,
              text: args.text ?? "",
            }),
          )
          return {
            title: "Opened side chat",
            output: JSON.stringify(result, null, 2),
            metadata: {},
          }
        }),
    }
  }),
)
