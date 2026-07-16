import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  label: z.string().optional().describe("Optional label used for the captured image file name."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export const AppCaptureWindowTool = Tool.define(
  "app_capture_window",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Capture a screenshot of the current local Lfcode desktop window and return the saved file path together with the latest UI state.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post<{ path?: string }>("/capture/window", {
              windowID: args.window_id,
              label: args.label,
            }),
          )
          return {
            title: "Captured desktop window",
            output: JSON.stringify(result, null, 2),
            metadata: {
              windowID: args.window_id,
              label: args.label,
              path: result?.path,
            },
          }
        }),
    }
  }),
)

export { parameters }
