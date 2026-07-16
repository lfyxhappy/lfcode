import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_id: z.string().min(1).describe("Existing side chat session ID to close."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppCloseSideChatTool = Tool.define(
  "app_close_side_chat",
  appBrowserTool(parameters, (app) => ({
    description: "Close an existing side chat tab in the local Lfcode desktop app.",
    execute: (args) =>
      Effect.gen(function* () {
        const client = yield* app.client("session_control")
        const result = yield* Effect.promise(() =>
          client.post("/sidechat/close", {
            windowID: args.window_id,
            sessionID: args.session_id,
          }),
        )
        return {
          title: "Closed side chat",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionID: args.session_id,
            windowID: args.window_id,
          },
        }
      }),
  })),
)
