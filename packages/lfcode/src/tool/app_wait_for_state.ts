import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const match = z
  .object({
    route: z.string().optional().describe("Expected route pathname, such as /settings or /<dir>/session/<id>."),
    session_id: z.string().optional().describe("Expected active main session ID."),
    active_tab: z.string().optional().describe("Expected active tab key in the current session view."),
    loading: z.boolean().optional().describe("Expected session loading state."),
    side_chat_count: z.number().int().nonnegative().optional().describe("Expected number of open side chats."),
    browser_tab_count: z.number().int().nonnegative().optional().describe("Expected number of open side browser tabs."),
    composer_target: z
      .enum(["main", "active_side"])
      .optional()
      .describe("Expected active composer target. Use active_side for the focused side chat composer."),
  })
  .optional()

const parameters = z.object({
  match,
  timeout_ms: z.number().int().positive().optional().describe("Maximum time to wait before returning the latest state."),
  interval_ms: z.number().int().positive().optional().describe("Polling interval used while waiting."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppWaitForStateTool = Tool.define(
  "app_wait_for_state",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Wait until the local Lfcode desktop app reaches a requested UI state. Use this after app-control write actions so the next step reads stable state instead of racing the UI.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post<{ matched?: boolean }>("/wait", {
              windowID: args.window_id,
              timeoutMs: args.timeout_ms,
              intervalMs: args.interval_ms,
              match: args.match
                ? {
                    route: args.match.route,
                    sessionID: args.match.session_id,
                    activeTab: args.match.active_tab,
                    loading: args.match.loading,
                    sideChatCount: args.match.side_chat_count,
                    browserTabCount: args.match.browser_tab_count,
                    composerTarget: args.match.composer_target === "active_side" ? "active-side" : args.match.composer_target,
                  }
                : undefined,
            }),
          )
          return {
            title: result?.matched ? "App state matched" : "App state wait timed out",
            output: JSON.stringify(result, null, 2),
            metadata: {
              matched: result?.matched === true,
              windowID: args.window_id,
            },
          }
        }),
    }
  }),
)

export { parameters }
