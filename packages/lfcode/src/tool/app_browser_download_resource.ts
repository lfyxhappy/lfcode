import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"

const parameters = z
  .object({
    session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
    url: z.string().optional().describe("Direct resource URL to download."),
    filename: z.string().optional().describe("Optional filename override for the saved resource."),
    resource_id: z.string().optional().describe("Optional resource ID from prior browser read results."),
    ref: z.string().optional().describe("Optional stable reference returned by prior browser reads or snapshots."),
    selector: z.string().optional().describe("Optional CSS selector used when no ref is available."),
    cache_policy: z
      .enum(["prefer-cache", "cache-only", "bypass-cache"])
      .optional()
      .describe("Optional cache policy. prefer-cache tries shared browser cache first, cache-only refuses network fallback, bypass-cache skips cache lookup."),
  })
  .refine((value) => !!value.url || !!value.resource_id || !!value.ref || !!value.selector, {
    message: "At least one of url, resource_id, ref, or selector is required.",
    path: ["url"],
  })

export const AppBrowserDownloadResourceTool = Tool.define(
  "app_browser_download_resource",
  appBrowserTool(parameters, (app) => ({
    description: "Download a resource referenced by the side browser, such as an image, audio, video, or direct asset URL.",
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const client = yield* app.browserClient("interactive")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const result = yield* Effect.promise(() =>
          client.post<{ ok?: boolean }>("/browser/download-resource", {
            sessionKey,
            url: args.url,
            filename: args.filename,
            resourceID: args.resource_id,
            ref: args.ref,
            selector: args.selector,
            cachePolicy: args.cache_policy,
          }),
        )
        return {
          title: result.ok ? "Downloaded side browser resource" : "Side browser resource cache miss",
          output: JSON.stringify(result, null, 2),
          metadata: {
            sessionKey,
            url: args.url,
            filename: args.filename,
            resourceID: args.resource_id,
            ref: args.ref,
            selector: args.selector,
            cachePolicy: args.cache_policy,
          },
        }
      }),
  })),
)
