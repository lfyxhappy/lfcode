import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  scope: z.enum(["main", "renderer", "server"]).optional().describe("Filter recent automation events by scope."),
  type: z.string().optional().describe("Optional exact event type filter."),
  limit: z.number().int().positive().max(500).optional().describe("Maximum number of recent events to return."),
})

export const AppGetEventsTool = Tool.define(
  "app_get_events",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Read recent structured desktop automation events for diagnostics, including navigation, side chat, browser, and tool invocation activity.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const params = new URLSearchParams()
          if (args.scope) params.set("scope", args.scope)
          if (args.type) params.set("type", args.type)
          if (args.limit) params.set("limit", String(args.limit))
          const query = params.size ? `?${params.toString()}` : ""
          const result = yield* Effect.promise(() => client.get(`/diagnostics/events${query}`))
          return {
            title: "Read desktop automation events",
            output: JSON.stringify(result, null, 2),
            metadata: {
              scope: args.scope,
              type: args.type,
              limit: args.limit,
            },
          }
        }),
    }
  }),
)

export { parameters }
