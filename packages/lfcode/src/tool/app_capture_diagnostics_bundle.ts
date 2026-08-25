import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
  label: z.string().optional().describe("Optional screenshot label used for the captured window artifact."),
  event_limit: z.number().int().positive().max(500).optional().describe("Maximum number of recent automation events to include."),
})

export const AppCaptureDiagnosticsBundleTool = Tool.define(
  "app_capture_diagnostics_bundle",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Capture a compact desktop diagnostics bundle that includes the current app state, recent automation events, and a window screenshot path.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const query = args.window_id ? `?windowID=${args.window_id}` : ""
          const state = yield* Effect.promise(() => client.get(`/diagnostics/ui-state${query}`))
          const eventsQuery = new URLSearchParams()
          if (args.event_limit) eventsQuery.set("limit", String(args.event_limit))
          const events = yield* Effect.promise(() =>
            client.get(`/diagnostics/events${eventsQuery.size ? `?${eventsQuery.toString()}` : ""}`),
          )
          const capture = yield* Effect.promise(() =>
            client.post("/capture/window", {
              windowID: args.window_id,
              label: args.label ?? "app-diagnostics",
            }),
          )
          return {
            title: "Captured desktop diagnostics bundle",
            output: JSON.stringify({ state, events, capture }, null, 2),
            metadata: {
              windowID: args.window_id,
              eventLimit: args.event_limit,
              capturePath:
                typeof capture === "object" && capture && "path" in capture ? (capture as { path?: string }).path : undefined,
            },
          }
        }),
    }
  }),
)
