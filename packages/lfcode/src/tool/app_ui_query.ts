import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"
import { appUiShared, buildAppUiBody } from "./app_ui_shared"

const parameters = z.union([
  z.object({
    action: z.literal("catalog"),
    window_id: z.number().optional().describe("Optional desktop window ID. Defaults to an available Lfcode window."),
  }),
  appUiShared.extend({
    action: z.literal("query"),
  }),
  appUiShared.extend({
    action: z.literal("read_text"),
  }),
  appUiShared.extend({
    action: z.literal("wait"),
    visible: z.boolean().optional().describe("Wait for the token to become visible or hidden. Omit to accept either state."),
    timeout_ms: z.number().int().positive().optional().describe("Maximum wait time in milliseconds."),
    interval_ms: z.number().int().positive().optional().describe("Polling interval in milliseconds."),
  }),
])

export const AppUiQueryTool = Tool.define(
  "app_ui_query",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Discover stable UI-driver tokens or read their state from the local desktop app. Query a token, read its current text/value, or wait for it to appear or change visibility.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() => {
            if (args.action === "catalog") {
              return client.get(`/ui/catalog${args.window_id === undefined ? "" : `?windowID=${args.window_id}`}`)
            }
            if (args.action === "query") return client.post("/ui/query", buildAppUiBody(args))
            if (args.action === "read_text") return client.post("/ui/read-text", buildAppUiBody(args))
            return client.post("/ui/wait", {
              ...buildAppUiBody(args),
              visible: args.visible,
              timeoutMs: args.timeout_ms,
              intervalMs: args.interval_ms,
            })
          })
          return {
            title:
              args.action === "catalog"
                ? "Listed available UI tokens"
                : args.action === "query"
                ? "Read UI token snapshot"
                : args.action === "read_text"
                  ? "Read UI token text"
                  : "Waited for UI token",
            output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            metadata: {
              windowID: args.window_id,
              action: args.action,
              ...(args.action === "catalog" ? {} : { token: args.token, blockKey: args.block_key }),
            },
          }
        }),
    }
  }),
)
