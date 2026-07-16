import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"
import { appUiShared, buildAppUiBody } from "./app_ui_shared"

const parameters = z.union([
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
        "Read stable UI-driver state from the local desktop app: snapshot a token, read its current text/value, or wait for it to appear or change visibility.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() => {
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
              args.action === "query"
                ? "Read UI token snapshot"
                : args.action === "read_text"
                  ? "Read UI token text"
                  : "Waited for UI token",
            output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            metadata: {
              token: args.token,
              blockKey: args.block_key,
              windowID: args.window_id,
              action: args.action,
            },
          }
        }),
    }
  }),
)
