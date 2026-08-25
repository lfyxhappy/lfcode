import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  after: z.number().int().nonnegative().optional().describe("Cursor returned by a previous app_wait_for_event or app_get_events call."),
  scope: z.enum(["main", "renderer", "server"]).optional().describe("Optional automation event scope filter."),
  type: z.string().optional().describe("Optional exact automation event type filter."),
  limit: z.number().int().positive().max(200).optional().describe("Maximum event count to return."),
  wait_ms: z.number().int().nonnegative().max(30_000).optional().describe("How long to wait for a matching event, up to 30 seconds."),
})

export const AppWaitForEventTool = Tool.define(
  "app_wait_for_event",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Read or efficiently wait for cursor-based local desktop automation events. Use the returned nextCursor for the next call instead of repeatedly reading the full event history.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const query = new URLSearchParams()
          if (args.after !== undefined) query.set("after", String(args.after))
          if (args.scope) query.set("scope", args.scope)
          if (args.type) query.set("type", args.type)
          if (args.limit) query.set("limit", String(args.limit))
          query.set("waitMs", String(args.wait_ms ?? 10_000))
          const result = yield* Effect.promise(() => client.get(`/diagnostics/events/next?${query.toString()}`))
          return {
            title: "Waited for desktop automation events",
            output: JSON.stringify(result, null, 2),
            metadata: {
              after: args.after ?? 0,
              scope: args.scope,
              type: args.type,
              limit: args.limit,
              waitMs: args.wait_ms ?? 10_000,
            },
          }
        }),
    }
  }),
)

export { parameters }
