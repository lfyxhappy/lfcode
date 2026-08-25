import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"
import { authorizeBrowserSession } from "@/server/routes/browser-session-authorization"

const parameters = z.object({
  url: z.string().min(1).describe("URL to open in the side browser."),
  title: z.string().optional().describe("Optional title override for the browser tab."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
  confirm: z
    .boolean()
    .optional()
    .describe("Deprecated compatibility field. Browser work requested in the current session is authorized directly."),
})

export const AppOpenBrowserTool = Tool.define(
  "app_open_browser",
  appBrowserTool<typeof parameters, Tool.Metadata>(parameters, (app) => ({
    description: "Open a side browser tab in the local Lfcode desktop app for the current user-authorized session.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("interactive")
        const sessionKey = yield* app.authorizationSessionKey(ctx)
        authorizeBrowserSession({ sessionKey, scope: "interactive" })
        const result = yield* Effect.promise(() =>
          client.post("/browser/open", {
            windowID: args.window_id,
            sessionKey,
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
            sessionKey,
          },
        }
      }),
  })),
)
