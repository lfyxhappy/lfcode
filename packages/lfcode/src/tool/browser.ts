import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { appBrowserTool } from "./app_browser_shared"
import { authorizeBrowserSession } from "@/server/routes/browser-session-authorization"

const assertCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), expected: z.string(), match: z.enum(["equals", "includes"]).optional() }),
  z.object({ kind: z.literal("title"), expected: z.string(), match: z.enum(["equals", "includes"]).optional() }),
  z.object({ kind: z.literal("text"), expected: z.string(), match: z.enum(["contains", "includes", "not_contains"]).optional() }),
  z.object({ kind: z.literal("selector"), selector: z.string(), visible: z.boolean().optional() }),
  z.object({ kind: z.literal("console"), mode: z.literal("has_no_error") }),
  z.object({ kind: z.literal("network"), mode: z.literal("has_no_failed_request") }),
])

const parameters = z.object({
  operation: z
    .enum([
      "open",
      "navigate",
      "read",
      "snapshot",
      "screenshot",
      "back",
      "forward",
      "reload",
      "wait_for_selector",
      "wait_for_url",
      "wait_for_load_state",
      "wait_for_navigation",
      "assert",
      "clear",
      "select_option",
      "upload_file",
      "capture_element",
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
  tab_id: z.string().optional().describe("Optional stable browser tab ID returned by open or navigate. When provided, operations target this tab exactly."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
  url: z.string().optional().describe("URL to open, filter, or download, depending on operation."),
  title: z.string().optional().describe("Optional title override when opening a browser tab."),
  presentation: z
    .enum(["headless", "detached", "sidebar"])
    .optional()
    .describe(
      "For operation=open or operation=navigate: headless is the default background channel backed by Lfcode's own embedded browser; detached opens that same browser in a visible independent window; sidebar opens it in the session side panel.",
    ),
  new_tab: z.boolean().optional().describe("For operation=open or operation=navigate, force creation of a new tab. Use the returned tab_id for subsequent operations."),
  ref: z.string().optional().describe("Stable browser element reference returned by read or snapshot. Prefer this when it is available."),
  selector: z.string().optional().describe("Optional CSS selector for element operations when no stable ref is available."),
  value: z.string().optional().describe("Option value for operation=select_option."),
  label: z.string().optional().describe("Option label for operation=select_option."),
  visible: z.boolean().optional().describe("Require a selector to be visible for wait_for_selector or selector assertions."),
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
  files: z.array(z.string()).min(1).optional().describe("Local files for operation=upload_file."),
  resource_id: z.string().optional().describe("Cached resource ID for operation=download_resource."),
  cache_policy: z
    .enum(["prefer-cache", "cache-only", "bypass-cache"])
    .optional()
    .describe("Cache policy for operation=download_resource."),
  match: z.enum(["equals", "includes", "contains", "not_contains"]).optional().describe("Matching mode for wait/assert operations."),
  state: z.enum(["domcontentloaded", "load", "networkidle"]).optional().describe("Load state for operation=wait_for_load_state."),
  stable_ms: z.number().int().positive().optional().describe("Required stable duration for load/navigation waits."),
  check: assertCheck.optional().describe("Single structured browser assertion."),
  checks: z.array(assertCheck).min(1).optional().describe("Batch of structured browser assertions."),
  // Compatibility shorthand for models that emit `assert` with the asserted
  // field at the top level (for example { operation: "assert", selector:
  // "h1" }) instead of nesting it under check/checks.
  assert_kind: z.enum(["url", "title", "text", "selector"]).optional().describe("Optional shorthand assertion kind."),
  since_ms: z.number().int().nonnegative().optional().describe("Only inspect console/network entries from this recent time window."),
})

type Parameters = z.infer<typeof parameters>

export const BrowserTool = Tool.define(
  "browser",
  appBrowserTool(parameters, (app) => ({
    description: [
      "Control Lfcode's built-in browser through one unified entrypoint; it is the default local frontend verification capability.",
      "For local HTML tests, url may be a file:// URL, an absolute Windows/Unix path, or a workspace-relative .html/.htm path; local paths are resolved against the current session workspace automatically.",
      "For browser-based validation, open the page first, then use read or snapshot, console, network, screenshot, and interactions to verify the rendered result.",
      "operation=open defaults to the headless background channel: it loads the same embedded-browser webview and automation bridge without displaying a window or taking over the user's sidebar. This is not an external Playwright browser. Use presentation=detached only when visual observation is useful, or presentation=sidebar when the user explicitly wants it docked.",
      "Use open or navigate to load a URL. Use back, forward, reload, click, type, scroll, clear, select_option, upload_file, capture_element, focus_tab, close, and download_resource only when interactive browser control is appropriate.",
      "Opening a page explicitly requested by the user authorizes this session; do not ask for a second confirmation.",
      "To test multiple tabs, call operation=open or operation=navigate with new_tab=true for the second and later tabs, then pass each returned tab_id on every operation.",
    ].join("\n"),
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const interactive = isInteractive(args.operation, args.presentation)
        const client = yield* app.browserClient(interactive ? "interactive" : "read_only")
        const sessionKey = yield* app.sessionKey(ctx, args.session_key)
        const browserTarget = { sessionKey, ...(args.tab_id ? { tabID: args.tab_id } : {}) }

        if (args.operation === "open" || args.operation === "navigate") {
          const rawURL = requireString(args.url, "url", args.operation)
          const url = yield* app.browserURL(ctx, rawURL)
          // Opening a headless target only needs read-only browser access, but
          // it still establishes the session's explicit navigation grant so
          // subsequent browser requests do not ask for confirmation again.
          authorizeBrowserSession({ sessionKey, scope: "interactive" })
          const result = yield* Effect.promise(() =>
            client.post("/browser/open", {
              windowID: args.window_id,
              ...browserTarget,
              url,
              title: args.title,
              presentation: args.presentation ?? "headless",
              newTab: args.new_tab === true,
            }),
          )
          return resultFor(args.operation === "open" ? "Opened browser test target" : "Navigated browser test target", result, {
            operation: args.operation,
            url,
            requestedURL: rawURL,
            presentation: args.presentation ?? "headless",
            sessionKey,
            tabID: getTabID(result) ?? args.tab_id,
          })
        }

        if (args.operation === "read") {
          const result = yield* Effect.promise(() => client.post("/browser/read-page", browserTarget))
          return resultFor("Read side browser page", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "snapshot") {
          const result = yield* Effect.promise(() => client.post("/browser/snapshot", browserTarget))
          return resultFor("Captured side browser snapshot", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "screenshot") {
          const result = yield* Effect.promise(() => client.post("/browser/screenshot", browserTarget))
          return resultFor("Captured side browser screenshot", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "back" || args.operation === "forward" || args.operation === "reload") {
          const result = yield* Effect.promise(() => client.post(`/browser/${args.operation}`, browserTarget))
          const title = args.operation === "back" ? "Navigated back in side browser" : args.operation === "forward" ? "Navigated forward in side browser" : "Reloaded side browser"
          return resultFor(title, result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "wait_for_selector") {
          const selector = requireString(args.selector, "selector", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/wait-selector", { ...browserTarget, selector, visible: args.visible === true, timeoutMs: args.timeout_ms, stableMs: args.stable_ms }))
          return resultFor("Waited for side browser selector", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "wait_for_url") {
          const rawURL = requireString(args.url, "url", args.operation)
          const url = yield* app.browserURL(ctx, rawURL)
          const result = yield* Effect.promise(() => client.post("/browser/wait-url", { ...browserTarget, url, match: args.match === "includes" ? "includes" : "equals", timeoutMs: args.timeout_ms, stableMs: args.stable_ms }))
          return resultFor("Waited for side browser URL", result, { operation: args.operation, sessionKey, tabID: args.tab_id, requestedURL: rawURL, url })
        }

        if (args.operation === "wait_for_load_state") {
          const state = requireValue(args.state, "state", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/wait-load-state", { ...browserTarget, state, timeoutMs: args.timeout_ms, stableMs: args.stable_ms }))
          return resultFor("Waited for side browser load state", result, { operation: args.operation, sessionKey, tabID: args.tab_id, state })
        }

        if (args.operation === "wait_for_navigation") {
          const rawURL = args.url === undefined ? undefined : args.url.trim()
          const url = rawURL ? yield* app.browserURL(ctx, rawURL) : undefined
          const result = yield* Effect.promise(() => client.post("/browser/wait-navigation", { ...browserTarget, url, match: args.match === "includes" ? "includes" : "equals", timeoutMs: args.timeout_ms, stableMs: args.stable_ms }))
          return resultFor("Waited for side browser navigation", result, { operation: args.operation, sessionKey, tabID: args.tab_id, requestedURL: rawURL, url })
        }

        if (args.operation === "assert") {
          const checks = normalizeAssertionChecks(args)
          if (checks.length === 0) throw new Error("browser operation=assert requires check or checks.")
          const result = yield* Effect.promise(() => runAssertions(client, browserTarget, checks, args.limit, args.since_ms))
          if (!result.passed) failAssertions(result)
          return resultFor("Browser assertions passed", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "clear") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/clear", { ...browserTarget, ref: args.ref, selector: args.selector }))
          return resultFor("Cleared side browser field", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "select_option") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          requireOneOf(args, ["value", "label", "text"], args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/select-option", {
            ...browserTarget,
            ref: args.ref,
            selector: args.selector,
            value: args.value,
            label: args.label,
            text: args.text,
          }))
          return resultFor("Selected side browser option", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "upload_file") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          if (!args.files?.length) throw new Error("browser operation=upload_file requires files.")
          const result = yield* Effect.promise(() => client.post("/browser/upload-file", {
            ...browserTarget,
            ref: args.ref,
            selector: args.selector,
            files: args.files,
          }))
          return resultFor("Uploaded files to side browser", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "capture_element") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/capture-element", { ...browserTarget, ref: args.ref, selector: args.selector }))
          return resultFor("Captured side browser element", result, { operation: args.operation, sessionKey, tabID: args.tab_id })
        }

        if (args.operation === "click") {
          requireOneOf(args, ["ref", "selector"], args.operation)
          const result = yield* Effect.promise(() =>
            client.post("/browser/click", { ...browserTarget, ref: args.ref, selector: args.selector }),
          )
          return resultFor("Clicked side browser element", result, {
            operation: args.operation,
            sessionKey,
            ref: args.ref,
            selector: args.selector,
          })
        }

        if (args.operation === "type") {
          const ref = requireString(args.ref, "ref", args.operation)
          const text = requireString(args.text, "text", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/type", { ...browserTarget, ref, text, submit: args.submit === true }))
          return resultFor("Typed in side browser element", result, { operation: args.operation, sessionKey, ref })
        }

        if (args.operation === "scroll") {
          const direction = requireValue(args.direction, "direction", args.operation)
          const result = yield* Effect.promise(() =>
            client.post("/browser/scroll", { ...browserTarget, ref: args.ref, selector: args.selector, direction, amount: args.amount }),
          )
          return resultFor("Scrolled side browser", result, { operation: args.operation, sessionKey, direction, amount: args.amount })
        }

        if (args.operation === "wait") {
          const result = yield* Effect.promise(() =>
            client.post<{ matched?: boolean }>("/browser/wait", {
              ...browserTarget,
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
          const result = yield* Effect.promise(() => client.post(`/browser/${args.operation}`, { ...browserTarget, limit: args.limit }))
          return resultFor(`Read side browser ${args.operation}`, result, { operation: args.operation, sessionKey, limit: args.limit })
        }

        if (args.operation === "close") {
          const result = yield* Effect.promise(() => client.post("/browser/close", browserTarget))
          return resultFor("Closed side browser tab", result, { operation: args.operation, sessionKey })
        }

        if (args.operation === "focus_tab") {
          const tabID = requireString(args.tab_id, "tab_id", args.operation)
          const result = yield* Effect.promise(() => client.post("/browser/focus-tab", { windowID: args.window_id, tabID, sessionKey }))
          return resultFor("Focused side browser tab", result, { operation: args.operation, tabID, windowID: args.window_id })
        }

        if (args.operation === "list_cached_resources") {
          const result = yield* Effect.promise(() =>
            client.post("/browser/list-cached-resources", {
              ...browserTarget,
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
            client.post("/browser/extract-resource", { ...browserTarget, ref: args.ref, selector: args.selector }),
          )
          return resultFor("Extracted side browser resource", result, { operation: args.operation, sessionKey, ref: args.ref, selector: args.selector })
        }

        requireOneOf(args, ["url", "resource_id", "ref", "selector"], args.operation)
        const result = yield* Effect.promise(() =>
          client.post<{ ok?: boolean }>("/browser/download-resource", {
            ...browserTarget,
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
  if (operation === "open" || operation === "navigate") return presentation !== undefined && presentation !== "headless"
  return ["back", "forward", "reload", "click", "type", "scroll", "clear", "select_option", "upload_file", "close", "focus_tab", "download_resource"].includes(operation)
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

function normalizeAssertionChecks(args: Parameters) {
  type Check = z.infer<typeof assertCheck>
  const checks = [...(args.check ? [args.check] : []), ...(args.checks ?? [])].map((check) =>
    check.kind === "text" && check.match === "includes" ? { ...check, match: "contains" as const } : check,
  )
  if (checks.length > 0) return checks
  if ((args.assert_kind === "selector" || !args.assert_kind) && args.selector) return [{ kind: "selector", selector: args.selector, visible: args.visible } satisfies Check]
  if ((args.assert_kind === "url" || !args.assert_kind) && args.url) return [{ kind: "url", expected: args.url, match: args.match === "includes" || args.match === "contains" ? "includes" : "equals" } satisfies Check]
  if ((args.assert_kind === "title" || !args.assert_kind) && args.title) return [{ kind: "title", expected: args.title, match: args.match === "includes" || args.match === "contains" ? "includes" : "equals" } satisfies Check]
  if ((args.assert_kind === "text" || !args.assert_kind) && args.text) return [{ kind: "text", expected: args.text, match: args.match === "not_contains" ? "not_contains" : "contains" } satisfies Check]
  return [] as Check[]
}

function resultFor(title: string, result: unknown, metadata: Tool.Metadata) {
  return { title, output: JSON.stringify(result, null, 2) ?? "null", metadata }
}

type BrowserClient = {
  post<T>(route: string, body?: unknown): Promise<T>
}

type AssertionResult = {
  passed: boolean
  checks: Array<Record<string, unknown>>
  target?: unknown
}

class BrowserAssertionError extends Error {
  readonly code = "browser_assertion_failed"
  readonly retryable = false
  readonly recovery = "Inspect the failed checks, then correct the page state or browser action before retrying."
  constructor(readonly result: AssertionResult) {
    super(`Browser assertions failed: ${JSON.stringify(result)}`)
    this.name = "BrowserAssertionError"
  }
}

function failAssertions(result: AssertionResult): never {
  throw new BrowserAssertionError(result)
}

function getTabID(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const direct = (value as { id?: unknown; tabID?: unknown; tab?: unknown }).tabID ?? (value as { id?: unknown }).id ?? (value as { tab?: unknown }).tab
  if (typeof direct === "string" && direct.startsWith("b_")) return direct
  const target = (value as { target?: unknown }).target
  if (!target || typeof target !== "object") return undefined
  const tabID = (target as { tabID?: unknown }).tabID
  return typeof tabID === "string" ? tabID : undefined
}

async function runAssertions(
  client: BrowserClient,
  target: { sessionKey: string; tabID?: string },
  checks: Array<z.infer<typeof assertCheck>>,
  limit?: number,
  sinceMs?: number,
): Promise<AssertionResult> {
  const [page, consoleLog, networkLog] = await Promise.all([
    client.post<{ title: string; url: string; text: string; interactive?: Array<{ selector?: string }>; target?: unknown }>("/browser/read-page", target),
    checks.some((check) => check.kind === "console")
      ? client.post<{ entries?: Array<{ level?: string; kind?: string; time?: number }>; target?: unknown }>("/browser/console", { ...target, limit: limit ?? 100 })
      : Promise.resolve(undefined),
    checks.some((check) => check.kind === "network")
      ? client.post<{ entries?: Array<{ statusCode?: number; error?: string; time?: number }>; target?: unknown }>("/browser/network", { ...target, limit: limit ?? 100 })
      : Promise.resolve(undefined),
  ])
  const cutoff = sinceMs === undefined ? undefined : Date.now() - sinceMs
  const selectorResults = await Promise.all(
    checks
      .filter((check): check is Extract<z.infer<typeof assertCheck>, { kind: "selector" }> => check.kind === "selector")
      .map(async (check) => [check.selector, await client.post<{ matched?: boolean }>("/browser/wait-selector", { ...target, selector: check.selector, visible: check.visible === true, timeoutMs: 1 })] as const),
  )
  const selectorMatches = new Map(selectorResults.map(([selector, result]) => [selector, result.matched === true]))
  const results = checks.map((check) => {
    if (check.kind === "url") return { kind: check.kind, expected: check.expected, actual: page.url, passed: matches(page.url, check.expected, check.match) }
    if (check.kind === "title") return { kind: check.kind, expected: check.expected, actual: page.title, passed: matches(page.title, check.expected, check.match) }
    if (check.kind === "text") {
      const contains = page.text.includes(check.expected)
      return { kind: check.kind, expected: check.expected, actual: page.text, passed: check.match === "not_contains" ? !contains : contains }
    }
    if (check.kind === "selector") {
      const found = selectorMatches.get(check.selector) === true
      return { kind: check.kind, selector: check.selector, visible: check.visible === true, passed: found }
    }
    if (check.kind === "console") {
      const entries = (consoleLog?.entries ?? []).filter((entry) => cutoff === undefined || (entry.time ?? 0) >= cutoff)
      const errors = entries.filter((entry) => entry.level === "error" || entry.kind === "pageerror" || entry.kind === "unhandledrejection")
      return { kind: check.kind, mode: check.mode, errorCount: errors.length, passed: errors.length === 0 }
    }
    const entries = (networkLog?.entries ?? []).filter((entry) => cutoff === undefined || (entry.time ?? 0) >= cutoff)
    const failed = entries.filter((entry, index) => {
      if (isBenignNavigationAbort(entry, entries, index)) return false
      return (entry.statusCode ?? 0) >= 400 || !!entry.error
    })
    return { kind: check.kind, mode: check.mode, failedCount: failed.length, passed: failed.length === 0 }
  })
  return { passed: results.every((result) => result.passed), checks: results, target: page.target }
}

function matches(actual: string, expected: string, mode?: "equals" | "includes") {
  return mode === "includes" ? actual.includes(expected) : actual === expected
}

function isBenignNavigationAbort(
  entry: { url?: string; error?: string; statusCode?: number; time?: number },
  entries: Array<{ url?: string; error?: string; statusCode?: number; time?: number }>,
  index: number,
) {
  if (!entry.error?.toLowerCase().includes("err_aborted")) return false
  if (!entry.url) return false
  return entries.slice(index + 1).some(
    (next) => next.url === entry.url && next.error === undefined && (next.statusCode ?? 0) >= 200 && (next.statusCode ?? 0) < 400,
  )
}
