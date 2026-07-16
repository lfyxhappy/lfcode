import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z.object({
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
  query: z.string().optional().describe("Optional substring match against cached/indexed resource URLs."),
  url: z.string().optional().describe("Optional exact URL filter."),
  limit: z.number().int().positive().optional().describe("Maximum number of entries to return."),
  resource_types: z.array(z.string()).optional().describe("Optional resourceType filters such as image, media, xhr, script."),
})

export const AppBrowserListCachedResourcesTool = Tool.define(
  "app_browser_list_cached_resources",
  appBrowserTool(parameters, (app) => ({
    description:
      "List recently observed resources from the shared Lfcode side-browser cache/index without triggering new network requests.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.client("read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post("/browser/list-cached-resources", {
            sessionKey,
            query: args.query,
            url: args.url,
            limit: args.limit,
            resourceTypes: args.resource_types,
          }),
        )
        return {
          title: "Listed side browser cached resources",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
            query: args.query,
            url: args.url,
            limit: args.limit,
            resourceTypes: args.resource_types,
          },
        }
      }),
  })),
)
