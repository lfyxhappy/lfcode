import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"
import { authorizeBrowserSession } from "@/server/routes/browser-session-authorization"

const parameters = z.object({
  operation: z
    .enum([
      "open",
      "read",
      "snapshot",
      "screenshot",
      "click",
      "type",
      "scroll",
      "wait",
      "console",
      "network",
      "close",
      "focus_tab",
      "list_cached_resources",
      "extract_resource",
      "download_resource",
    ])
    .describe("Browser operation to run."),
  session_key: z.string().optional().describe("Optional side-browser session key. Defaults to the current chat session."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
  url: z.string().optional().describe("URL to open, filter, or download, depending on operation."),
  title: z.string().optional().describe("Optional title override when opening a browser tab."),
  presentation: z
    .enum(["headless", "detached", "sidebar"])
    .optional()
    .describe(
      "For operation=open: headless is the default background channel backed by Lfcode's own embedded browser; detached opens that same browser in a visible independent window; sidebar opens it in the session side panel.",
    ),
  tab_id: z.string().optional().describe("Existing side-browser tab ID for operation=focus_tab."),
  ref: z.string().optional().describe("Stable browser element reference returned by read or snapshot."),
  selector: z.string().optional().describe("Optional CSS selector when no stable ref is available."),
  text: z.string().optional().describe("Text for operation=type or a wait condition."),
  text_gone: z.string().optional().describe("Text that must disappear for operation=wait."),
  submit: z.boolean().optional().describe("Submit after operation=type."),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction for operation=scroll."),
  amount: z.number().int().positive().optional().describe("Optional scroll distance in pixels."),
  time_ms: z.number().int().positive().optional().describe("Optional in-browser delay for operation=wait."),
  timeout_ms: z.number().int().positive().optional().describe("Maximum duration for operation=wait."),
  limit: z.number().int().positive().max(500).optional().describe("Maximum number of console, network, or cached-resource entries."),
  query: z.string().optional().describe("Optional cached-resource URL substring filter."),
  resource_types: z.array(z.string()).optional().describe("Optional cached-resource types such as image, media, xhr, or script."),
  filename: z.string().optional().describe("Optional filename for operation=download_resource."),
  resource_id: z.string().optional().describe("Cached resource ID for operation=download_resource."),
  cache_policy: z
    .enum(["prefer-cache", "cache-only", "bypass-cache"])
    .optional()
    .describe("Cache policy for operation=download_resource."),
})

type Parameters = z.infer<typeof parameters>

export const BrowserTool = Tool.define(
  "browser",
  appBrowserTool(parameters, (app) => ({
    description: [
      "Control Lfcode's built-in browser through one unified entrypoint; it is the default local frontend verification capability.",
      "For browser-based validation, open the page first, then use read or snapshot, console, network, screenshot, and interactions to verify the rendered result.",
      "operation=open defaults to the headless background channel: it loads the same embedded-browser webview and automation bridge without displaying a window or taking over the user's sidebar. This is not an external Playwright browser. Use presentation=detached only when visual observation is useful, or presentation=sidebar when the user explicitly wants it docked.",
      "Use click, type, scroll, open, focus_tab, close, and download_resource only when interactive browser control is appropriate.",
      "Opening a page explicitly requested by the user authorizes this session; do not ask for a second confirmation.",
    ].join("\n"),
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const interactive = isInteractive(args.operation, args.presentation)
        const client = yield* app.browserClient(interactive ? "interactive" : "read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)

        if (args.operation === "open") {
          const url = requireString(args.url, "url", args.operation)
          // Opening a headless target only needs read-only browser access, but
          // it still establishes the session's explicit navigation grant so
          // subsequent browser requests do not ask for confirmation again.
          authorizeBrowserSession({ sessionKey, scope: "interactive" })
          const result = yield* Effect.promise(() =>
            client.post("/browser/open", {
              windowID: args.window_id,
              sessionKey,
              url,
              title: args.title,
              presentation: args.presentation ?? "headless",
            }),
          )
          return resultFor("Opened browser test target", result, {
            operation: args.operation,
            url,
            presentation: args.presentation ?? "headless",
            sessionKey,
          })
        }

        if (args.operation === "read") {
          const result = yield* Effect.promise(() => client.post("/browser/read-page", { sessionKey }))
          return resultFor("Read side browser page", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "snapshot") {
          const result = yield* Effect.promise(() => client.post("/browser/snapshot", { sessionKey }))
          return resultFor("Captured side browser snapshot", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "screenshot") {
          const result = yield* Effect.promise(() => client.post("/browser/screenshot", { sessionKey }))
          return resultFor("Captured side browser screenshot", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "click") {
          const ref = requireString(args.ref, "ref", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/click", { sessionKey, ref }))
          return resultFor("Clicked side browser element", result, { operation: args.operation, sessionKey, ref })
        }

        if (args.operation === "type") {
          const ref = requireString(args.ref, "ref", args.operation)
          const text = requireString(args.text, "text", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/type", { sessionKey, ref, text, submit: args.submit === true }))
          return resultFor("Typed in side browser element", result, { operation: args.operation, sessionKey, ref })
        }

        if (args.operation === "scroll") {
          const direction = requireValue(args.direction, "direction", args.operation)
          const result = yield* Effect.promise(() =>
            client.post("/browser/scroll", { sessionKey, ref: args.ref, selector: args.selector, direction, amount: args.amount }),
          )
          return resultFor("Scrolled side browser", result, { operation: args.operation, sessionKey, direction, amount: args.amount })
        }

        if (args.operation === "wait") {
          const result = yield* Effect.promise(() =>
            client.post<{ matched?: boolean }>("/browser/wait", {
              sessionKey,
              text: args.text,
              textGone: args.text_gone,
              timeMs: args.time_ms,
              timeoutMs: args.timeout_ms,
            }),
          )
          return resultFor(result?.matched ? "Browser wait matched" : "Browser wait timed out", result, {
            operation: args.operation,
            sessionKey,
            matched: result?.matched === true,
          })
        }

        if (args.operation === "console" || args.operation === "network") {
          const result = yield* Effect.promise(() => client.post(`/browser/${args.operation}`, { sessionKey, limit: args.limit }))
          return resultFor(`Read side browser ${args.operation}`, result, { operation: args.operation, sessionKey, limit: args.limit })
        }

        if (args.operation === "close") {
          const result = yield* Effect.promise(() => client.post("/browser/close", { sessionKey }))
          return resultFor("Closed side browser tab", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "focus_tab") {
          const tabID = requireString(args.tab_id, "tab_id", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/focus-tab", { windowID: args.window_id, tabID }))
          return resultFor("Focused side browser tab", result, { operation: args.operation, tabID, windowID: args.window_id })
        }

        if (args.operation === "list_cached_resources") {
          const result = yield* Effect.promise(() =>
            client.post("/browser/list-cached-resources", {
              sessionKey,
              query: args.query,
              url: args.url,
              limit: args.limit,
              resourceTypes: args.resource_types,
            }),
          )
          return resultFor("Listed side browser cached resources", result, { operation: args.operation, sessionKey, query: args.query })
        }

        if (args.operation === "extract_resource") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          const result = yield* Effect.promise(() =>
            client.post("/browser/extract-resource", { sessionKey, ref: args.ref, selector: args.selector }),
          )
          return resultFor("Extracted side browser resource", result, { operation: args.operation, sessionKey, ref: args.ref, selector: args.selector })
        }

        requireOneOf(args, ["url", "resource_id", "ref", "selector"], args.operation)
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
        return resultFor(result.ok ? "Downloaded side browser resource" : "Side browser resource cache miss", result, {
          operation: args.operation,
          sessionKey,
          url: args.url,
          resourceID: args.resource_id,
        })
      }),
  })),
)

function isInteractive(operation: Parameters["operation"], presentation?: Parameters["presentation"]) {
  if (operation === "open") return presentation !== undefined && presentation !== "headless"
  return ["click", "type", "scroll", "close", "focus_tab", "download_resource"].includes(operation)
}

function requireString(value: string | undefined, field: string, operation: string) {
  if (value) return value
  throw new Error(`browser operation=${operation} requires ${field}.`)
}

function requireValue<Value>(value: Value | undefined, field: string, operation: string) {
  if (value !== undefined) return value
  throw new Error(`browser operation=${operation} requires ${field}.`)
}

function requireOneOf(args: Parameters, fields: Array<keyof Parameters>, operation: string) {
  if (fields.some((field) => args[field])) return
  throw new Error(`browser operation=${operation} requires one of ${fields.join(", ")}.`)
}

function resultFor(title: string, result: unknown, metadata: Tool.Metadata) {
  return { title, output: JSON.stringify(result, null, 2), metadata }
}
