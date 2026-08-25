import { Hono } from "hono"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  type DesktopBrowserAutomationCachedResourceList,
  type DesktopBrowserAutomationConsoleLog,
  getDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationElementCapture,
  type DesktopBrowserAutomationDownload,
  type DesktopBrowserAutomationNetworkLog,
  type DesktopBrowserAutomationPage,
  type DesktopBrowserAutomationResourceSnapshot,
  type DesktopBrowserAutomationScreenshot,
  type DesktopBrowserAutomationSnapshot,
  type DesktopBrowserAutomationTarget,
  type DesktopBrowserAutomationWaitResult,
} from "@lfcode-ai/shared/desktop-browser-automation"
import z from "zod/v4"
import { InstallationVersion } from "@/installation/version"
import {
  allowBrowserNavigation,
  browserConfirmationRequired,
  browserSessionKey,
  clearBrowserNavigationAuthorization,
} from "./browser-session-authorization"

export const PlaywrightMcpRoutes = () =>
  new Hono().all("/mcp/playwright", async (c) => {
    const directory = decodeOwnerDirectory(c.req.header("x-lfcode-directory"))
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    const server = createPlaywrightMcpServer({ directory })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

function createPlaywrightMcpServer(owner: { directory?: string }) {
  const server = new McpServer(
    {
      name: "lfcode-playwright",
      version: InstallationVersion,
    },
    {
      instructions:
        "Tools in this MCP server only target the side browser owned by the current Lfcode session. browser_navigate never creates a tab implicitly: if no target exists, ask the user for browser access and retry with confirm=true. Prefer browser_read_page or browser_snapshot before acting. After navigation or actions that may refresh the page, use browser_wait_for_selector, browser_wait_for_url, browser_wait_for_load_state, or browser_wait_for_navigation instead of guessing. If a page behaves unexpectedly, check browser_screenshot, browser_get_console, and browser_get_network before retrying.",
    },
  )

  const ownerInputSchema = z.object({
    _lfcodeSessionID: z.string().optional(),
  })

  server.registerTool(
    "browser_get_state",
    {
      description:
        "Get the current Lfcode side browser target for this session. If none exists yet, this returns startup guidance instead of failing.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const target = requireBridge().getTarget({ sessionKey })
      if (!target) {
        return result(
          "No Lfcode side browser tab exists yet for this session. browser_confirmation_required: ask the user to allow opening the side browser, then retry browser_navigate with confirm=true.",
        )
      }
      allowBrowserNavigation({ sessionKey, hasTarget: true })
      return result(`Active side browser: ${target.title || "<untitled>"} ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate the current session's Lfcode side browser tab to a URL. When no tab exists, confirm=true is required before creating one.",
      inputSchema: ownerInputSchema.extend({
        url: z.string(),
        confirm: z
          .boolean()
          .optional()
          .describe("Required on the first navigation when this session has no browser target."),
      }),
    },
    async ({ url, confirm, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const hasTarget = !!requireBridge().getTarget({ sessionKey })
      if (!allowBrowserNavigation({ sessionKey, hasTarget, confirm })) {
        const confirmation = browserConfirmationRequired({
          sessionKey,
          url,
          reason: "Opening or navigating the side browser needs explicit user approval.",
        })
        return result(JSON.stringify(confirmation))
      }
      const target = await requireBridge().navigate({ sessionKey, sessionID: _lfcodeSessionID, url })
      return result(`Navigated side browser to ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_snapshot",
    {
      description: "Capture a structured snapshot of interactive elements from the current session's Lfcode side browser tab.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const snapshot = await requireBridge().snapshot({ sessionKey })
      return result(snapshot.text, snapshot)
    },
  )

  server.registerTool(
    "browser_screenshot",
    {
      description: "Capture a screenshot of the current session's Lfcode side browser tab and return the saved image path.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const screenshot = await requireBridge().screenshot({ sessionKey })
      return result(`Saved side browser screenshot to ${screenshot.path}`, screenshot)
    },
  )

  server.registerTool(
    "browser_read_page",
    {
      description:
        "Read a structured summary of the current session's side browser page, including visible text, headings, interactive elements, and key media.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const page = await requireBridge().readPage({ sessionKey })
      return result(formatPageSummary(page), page)
    },
  )

  server.registerTool(
    "browser_extract_resource",
    {
      description:
        "Extract structured metadata for page media resources. Provide ref or selector to target one element, or omit both to list visible media on the page.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
      }),
    },
    async ({ ref, selector, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const resources = await requireBridge().extractResource({
        sessionKey,
        ref,
        selector,
      })
      return result(formatResourceSummary(resources), resources)
    },
  )

  server.registerTool(
    "browser_capture_element",
    {
      description:
        "Capture a screenshot of a specific element, usually after browser_snapshot or browser_read_page. Provide ref or selector.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
      }),
    },
    async ({ ref, selector, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const capture = await requireBridge().captureElement({
        sessionKey,
        ref,
        selector,
      })
      return result(`Captured element screenshot to ${capture.path}`, capture)
    },
  )

  server.registerTool(
    "browser_get_console",
    {
      description: "Read recent console output and page errors from the current session's side browser tab.",
      inputSchema: ownerInputSchema.extend({
        limit: z.number().int().positive().optional(),
      }),
    },
    async ({ limit, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const consoleLog = await requireBridge().getConsole({
        sessionKey,
        limit,
      })
      return result(formatConsoleSummary(consoleLog), consoleLog)
    },
  )

  server.registerTool(
    "browser_get_network",
    {
      description: "Read recent network activity and failures from the current session's side browser tab.",
      inputSchema: ownerInputSchema.extend({
        limit: z.number().int().positive().optional(),
      }),
    },
    async ({ limit, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const networkLog = await requireBridge().getNetwork({
        sessionKey,
        limit,
      })
      return result(formatNetworkSummary(networkLog), networkLog)
    },
  )

  server.registerTool(
    "browser_list_cached_resources",
    {
      description:
        "List recently observed resources from the shared Lfcode side-browser cache/index. This only reads the cache index and does not trigger new network requests.",
      inputSchema: ownerInputSchema.extend({
        query: z.string().optional(),
        url: z.string().optional(),
        limit: z.number().int().positive().optional(),
        resourceTypes: z.array(z.string()).optional(),
      }),
    },
    async ({ query, url, limit, resourceTypes, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const cached = await requireBridge().listCachedResources({
        sessionKey,
        query,
        url,
        limit,
        resourceTypes,
      })
      return result(formatCachedResourceSummary(cached), cached)
    },
  )

  server.registerTool(
    "browser_download_resource",
    {
      description:
        "Download a direct browser resource URL using the current side browser session and save it locally. Useful after browser_extract_resource.",
      inputSchema: ownerInputSchema.extend({
        url: z.string().optional(),
        filename: z.string().optional(),
        resourceID: z.string().optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        cachePolicy: z.enum(["prefer-cache", "cache-only", "bypass-cache"]).optional(),
      }),
    },
    async ({ url, filename, resourceID, ref, selector, cachePolicy, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const download = await requireBridge().downloadResource({
        sessionKey,
        url,
        filename,
        resourceID,
        ref,
        selector,
        cachePolicy,
      })
      if (!download.ok) {
        return result(`Browser cache miss for ${download.url}; cache-only request did not fall back to network.`, download)
      }
      const detail = download.path ? `Downloaded browser resource to ${download.path}` : `Downloaded browser resource from ${download.url}`
      const provenance = ` source=${download.sourceKind} cacheObserved=${download.cacheObserved} cacheHit=${download.cacheHit} fallbackUsed=${download.fallbackUsed}`
      return result(detail + provenance, download)
    },
  )

  server.registerTool(
    "browser_scroll",
    {
      description:
        "Scroll the current side browser page or scroll a specific element into view. Provide ref or selector to target an element, or omit both for page scrolling.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
        direction: z.enum(["up", "down", "left", "right"]).optional(),
        amount: z.number().int().positive().optional(),
      }),
    },
    async ({ ref, selector, direction, amount, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().scroll({
        sessionKey,
        ref,
        selector,
        direction,
        amount,
      })
      return result(`Scrolled ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_hover",
    {
      description: "Hover a visible element in the current side browser page. Provide ref from browser_snapshot or a selector.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
      }),
    },
    async ({ ref, selector, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().hover({ sessionKey, ref, selector })
      return result(`Hovered browser element on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_focus",
    {
      description: "Focus an element in the current side browser page. Provide ref from browser_snapshot or a selector.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
      }),
    },
    async ({ ref, selector, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().focus({ sessionKey, ref, selector })
      return result(`Focused browser element on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_clear",
    {
      description: "Clear an editable element in the current side browser page. Provide ref from browser_snapshot or a selector.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
      }),
    },
    async ({ ref, selector, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().clear({ sessionKey, ref, selector })
      return result(`Cleared browser element on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_select_option",
    {
      description:
        "Select an option in a <select> element. Provide ref from browser_snapshot or a selector, plus one of value, label, or text.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
        value: z.string().optional(),
        label: z.string().optional(),
        text: z.string().optional(),
      }),
    },
    async ({ ref, selector, value, label, text, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().selectOption({
        sessionKey,
        ref,
        selector,
        value,
        label,
        text,
      })
      return result(`Selected browser option on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_upload_file",
    {
      description:
        "Upload one or more local files into an <input type=file> element. Provide ref from browser_snapshot or a selector. Paths must stay inside the current project directory or Lfcode-managed output paths.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string().optional(),
        selector: z.string().optional(),
        files: z.array(z.string()).min(1),
      }),
    },
    async ({ ref, selector, files, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().uploadFile({
        sessionKey,
        ref,
        selector,
        files,
      })
      return result(`Uploaded ${files.length} file(s) on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_click",
    {
      description: "Click an element from the latest browser_snapshot result by ref, such as e3.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string(),
      }),
    },
    async ({ ref, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().click({ sessionKey, ref })
      return result(`Clicked ${ref} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_type",
    {
      description: "Type into an element from the latest browser_snapshot result by ref.",
      inputSchema: ownerInputSchema.extend({
        ref: z.string(),
        text: z.string(),
        submit: z.boolean().optional(),
      }),
    },
    async ({ ref, text, submit, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().type({ sessionKey, ref, text, submit })
      return result(`Typed into ${ref}${submit ? " and submitted" : ""} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_press_key",
    {
      description: "Press a key in the active Lfcode side browser tab.",
      inputSchema: ownerInputSchema.extend({
        key: z.string(),
      }),
    },
    async ({ key, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().pressKey({ sessionKey, key })
      return result(`Pressed ${key} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_back",
    {
      description: "Navigate back in the current side browser tab history.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const target = await requireBridge().back({ sessionKey })
      return result(`Navigated back on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_forward",
    {
      description: "Navigate forward in the current side browser tab history.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const target = await requireBridge().forward({ sessionKey })
      return result(`Navigated forward on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_reload",
    {
      description: "Reload the current side browser tab.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const target = await requireBridge().reload({ sessionKey })
      return result(`Reloaded ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_close",
    {
      description: "Close the current session-owned side browser tab.",
      inputSchema: ownerInputSchema,
    },
    async (input) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, input._lfcodeSessionID)
      const target = await requireBridge().close({ sessionKey })
      clearBrowserNavigationAuthorization(sessionKey)
      return result(target ? `Closed browser tab. Active browser is now ${target.url}` : "Closed the current side browser tab.", target)
    },
  )

  server.registerTool(
    "browser_wait_for_selector",
    {
      description: "Wait for a selector to exist on the current side browser page. Set visible=true to require a visible element.",
      inputSchema: ownerInputSchema.extend({
        selector: z.string(),
        visible: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
    },
    async ({ selector, visible, timeoutMs, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const wait = await requireBridge().waitForSelector({
        sessionKey,
        selector,
        visible,
        timeoutMs,
      })
      return result(wait.matched ? `Selector matched: ${selector}` : `Timed out waiting for selector: ${selector}`, wait)
    },
  )

  server.registerTool(
    "browser_wait_for_url",
    {
      description: "Wait for the active side browser URL to equal or include a target URL fragment.",
      inputSchema: ownerInputSchema.extend({
        url: z.string(),
        match: z.enum(["equals", "includes"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
    },
    async ({ url, match, timeoutMs, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const wait = await requireBridge().waitForUrl({
        sessionKey,
        url,
        match,
        timeoutMs,
      })
      return result(wait.matched ? `URL matched: ${url}` : `Timed out waiting for URL: ${url}`, wait)
    },
  )

  server.registerTool(
    "browser_wait_for_load_state",
    {
      description: "Wait for a page load state after navigation. Supports domcontentloaded, load, and a lightweight networkidle approximation.",
      inputSchema: ownerInputSchema.extend({
        state: z.enum(["domcontentloaded", "load", "networkidle"]),
        timeoutMs: z.number().int().positive().optional(),
        stableMs: z.number().int().positive().optional(),
      }),
    },
    async ({ state, timeoutMs, stableMs, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const wait = await requireBridge().waitForLoadState({
        sessionKey,
        state,
        timeoutMs,
        stableMs,
      })
      return result(wait.matched ? `Load state matched: ${state}` : `Timed out waiting for load state: ${state}`, wait)
    },
  )

  server.registerTool(
    "browser_wait_for_navigation",
    {
      description:
        "Wait for navigation to complete in the active side browser tab. Optionally provide a target URL to wait for.",
      inputSchema: ownerInputSchema.extend({
        url: z.string().optional(),
        match: z.enum(["equals", "includes"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        stableMs: z.number().int().positive().optional(),
      }),
    },
    async ({ url, match, timeoutMs, stableMs, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const wait = await requireBridge().waitForNavigation({
        sessionKey,
        url,
        match,
        timeoutMs,
        stableMs,
      })
      return result(wait.matched ? "Navigation completed." : "Timed out waiting for navigation.", wait)
    },
  )

  server.registerTool(
    "browser_wait_for",
    {
      description: "Wait for text to appear, text to disappear, or a fixed delay in the active side browser tab.",
      inputSchema: ownerInputSchema.extend({
        text: z.string().optional(),
        textGone: z.string().optional(),
        time: z.number().int().nonnegative().optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
    },
    async ({ text, textGone, time, timeoutMs, _lfcodeSessionID }) => {
      const sessionKey = requireOwnerSessionKey(owner.directory, _lfcodeSessionID)
      const target = await requireBridge().waitFor({
        sessionKey,
        text,
        textGone,
        timeMs: time ? time * 1000 : undefined,
        timeoutMs,
      })
      return result(
        target.matched ? "Browser wait condition matched." : "Browser wait condition timed out.",
        target,
      )
    },
  )

  return server
}

function decodeOwnerDirectory(value: string | undefined) {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function requireOwnerSessionKey(directory: string | undefined, sessionID: string | undefined) {
  if (!directory || !sessionID) {
    throw new Error("Lfcode session-owned browser routing is unavailable because the current session context was not provided")
  }
  return browserSessionKey({ directory: normalizeOwnerDirectory(directory), sessionID })
}

function normalizeOwnerDirectory(directory: string) {
  return directory.replace(/\\/g, "/")
}

function requireBridge() {
  const bridge = getDesktopBrowserAutomationBridge()
  if (bridge) return bridge
  throw new Error("Lfcode desktop side browser automation is unavailable in this runtime")
}

function result(
  text: string,
  structuredContent?:
    | DesktopBrowserAutomationTarget
    | DesktopBrowserAutomationSnapshot
    | DesktopBrowserAutomationScreenshot
    | DesktopBrowserAutomationPage
    | DesktopBrowserAutomationResourceSnapshot
    | DesktopBrowserAutomationElementCapture
    | DesktopBrowserAutomationCachedResourceList
    | DesktopBrowserAutomationConsoleLog
    | DesktopBrowserAutomationNetworkLog
    | DesktopBrowserAutomationDownload
    | DesktopBrowserAutomationWaitResult,
) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

function formatPageSummary(page: DesktopBrowserAutomationPage) {
  const sections = [
    `Title: ${page.title || "<untitled>"}`,
    `URL: ${page.url}`,
    `Ready state: ${page.readyState}`,
    page.headings.length > 0
      ? `Headings:\n${page.headings.map((item) => `- h${item.level}: ${item.text}`).join("\n")}`
      : undefined,
    page.media.length > 0
      ? `Media:\n${page.media
          .slice(0, 10)
          .map((item) => `- ${item.kind}: ${item.currentSrc || item.src || item.poster || item.selector}`)
          .join("\n")}`
      : undefined,
    page.interactive.length > 0
      ? `Interactive elements:\n${page.interactive
          .slice(0, 20)
          .map((item) => `- ${item.ref} <${item.tag}> ${item.text || item.placeholder || item.href || ""}`.trim())
          .join("\n")}`
      : undefined,
    page.text ? `Visible text excerpt:\n${page.text}` : undefined,
  ]
  return sections.filter(Boolean).join("\n\n")
}

function formatResourceSummary(snapshot: DesktopBrowserAutomationResourceSnapshot) {
  if (snapshot.resources.length === 0) return "No matching media resources were found on the current side browser page."
  return snapshot.resources
    .slice(0, 20)
    .map((item) => {
      const primary = item.primarySource?.url || item.currentSrc || item.src || item.poster || item.href || item.selector
      const requested = item.sources?.find((source) => source.requested)?.url
      const hint = item.pageHint ? ` hint=${item.pageHint}` : ""
      const state = item.downloadable
        ? "downloadable"
        : item.limitation
          ? `limited=${item.limitation}`
          : item.reason
            ? `limited=${item.reason}`
            : "metadata-only"
      const recommendation = item.recommendedAction ? ` next=${item.recommendedAction}` : ""
      const why = item.recommendedReason ? ` why=${item.recommendedReason}` : ""
      return `- ${item.kind}: ${primary}${requested && requested !== primary ? ` requested=${requested}` : ""} ${state}${hint}${recommendation}${why}`
    })
    .join("\n")
}

function formatConsoleSummary(log: DesktopBrowserAutomationConsoleLog) {
  if (log.entries.length === 0) return "No recent browser console output was recorded for this session."
  return log.entries
    .map((item) => {
      const origin = item.kind && item.kind !== "console" ? `${item.kind}/` : ""
      const location =
        item.sourceId || item.line || item.column
          ? ` (${item.sourceId || "<inline>"}${item.line ? `:${item.line}` : ""}${item.column ? `:${item.column}` : ""})`
          : ""
      return `- [${origin}${item.level}] ${item.message}${location}`
    })
    .join("\n")
}

function formatNetworkSummary(log: DesktopBrowserAutomationNetworkLog) {
  if (log.entries.length === 0) return "No recent browser network activity was recorded for this session."
  return log.entries
    .map((item) => {
      const status = item.error ? `error=${item.error}` : item.statusCode ? `status=${item.statusCode}` : "pending"
      const type = item.mimeType ? ` mime=${item.mimeType}` : item.resourceType ? ` type=${item.resourceType}` : ""
      const disposition = item.contentDisposition ? ` disposition=${item.contentDisposition}` : ""
      return `- ${item.method} ${item.url} ${status}${type}${disposition}`
    })
    .join("\n")
}

function formatCachedResourceSummary(result: DesktopBrowserAutomationCachedResourceList) {
  if (result.entries.length === 0) {
    return `No cached/indexed browser resources matched. Indexed entries=${result.indexedEntryCount}, cache size=${result.cacheSizeBytes} bytes.`
  }
  return [
    `Indexed entries: ${result.indexedEntryCount}`,
    `Cache size bytes: ${result.cacheSizeBytes}`,
    ...result.entries.map((item) => {
      const status = item.statusCode ? `status=${item.statusCode}` : "status=pending"
      const type = item.mimeType ? ` mime=${item.mimeType}` : item.resourceType ? ` type=${item.resourceType}` : ""
      const cache = item.cacheObserved ? " cacheObserved=true" : ""
      return `- ${item.method} ${item.url} ${status}${type}${cache} observations=${item.observations}`
    }),
  ].join("\n")
}
