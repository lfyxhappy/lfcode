import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  url: z.string().min(1).describe("URL to open in the side browser."),
  title: z.string().optional().describe("Optional title override for the browser tab."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppOpenBrowserTool = Tool.define(
  "app_open_browser",
  appBrowserTool(parameters, (app) => ({
    description: "Open a new side browser tab in the local Lfcode desktop app.",
    execute: (args) =>
      Effect.gen(function* () {
        const client = yield* app.client("browser_control")
        const result = yield* Effect.promise(() =>
          client.post("/browser/open", {
            windowID: args.window_id,
            url: args.url,
            title: args.title,
          }),
        )
        return {
          title: "Opened side browser tab",
          output: JSON.stringify(result, null, 2),
          metadata: {
            windowID: args.window_id,
            url: args.url,
          },
        }
      }),
  })),
)
