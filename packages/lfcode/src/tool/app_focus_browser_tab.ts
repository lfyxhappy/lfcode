import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  tab_id: z.string().min(1).describe("Existing side-browser tab ID to focus and activate."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppFocusBrowserTabTool = Tool.define(
  "app_focus_browser_tab",
  appBrowserTool(parameters, (app) => ({
    description: "Focus an existing side browser tab in the local Lfcode desktop app.",
    execute: (args) =>
      Effect.gen(function* () {
        const client = yield* app.client("browser_control")
        const result = yield* Effect.promise(() =>
          client.post("/browser/focus-tab", {
            windowID: args.window_id,
            tabID: args.tab_id,
          }),
        )
        return {
          title: "Focused side browser tab",
          output: JSON.stringify(result, null, 2),
          metadata: {
            tabID: args.tab_id,
            windowID: args.window_id,
          },
        }
      }),
  })),
)
