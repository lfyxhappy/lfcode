import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"
import { appUiWriteShared, buildAppUiBody } from "./app_ui_shared"

const parameters = z.union([
  appUiWriteShared.extend({
    action: z.literal("click"),
  }),
  appUiWriteShared.extend({
    action: z.literal("type"),
    text: z.string().describe("Text to place into the target. Works with composers and phase0 code editors."),
    append: z.boolean().optional().describe("Append to the current value instead of replacing it."),
  }),
])

export const AppUiActionTool = Tool.define(
  "app_ui_action",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Drive stable UI-driver targets in the local desktop app: click token-backed controls or type into token-backed inputs and editors.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() => {
            if (args.action === "click") return client.post("/ui/click", buildAppUiBody(args))
            return client.post("/ui/type", {
              ...buildAppUiBody(args),
              text: args.text,
              append: args.append,
            })
          })
          return {
            title: args.action === "click" ? "Clicked UI token" : "Typed into UI token",
            output: JSON.stringify(result, null, 2),
            metadata: {
              token: args.token,
              blockKey: args.block_key,
              windowID: args.window_id,
              action: args.action,
              ...(args.action === "type" ? { append: args.append ?? false } : {}),
            },
          }
        }),
    }
  }),
)
