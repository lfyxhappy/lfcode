import { Hono } from "hono"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  getDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationSnapshot,
  type DesktopBrowserAutomationTarget,
  type DesktopBrowserAutomationWaitResult,
} from "@lfcode-ai/shared/desktop-browser-automation"
import z from "zod/v4"
import { InstallationVersion } from "@/installation/version"

export const PlaywrightMcpRoutes = () =>
  new Hono().all("/mcp/playwright", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    const server = createPlaywrightMcpServer()
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

function createPlaywrightMcpServer() {
  const server = new McpServer(
    {
      name: "lfcode-playwright",
      version: InstallationVersion,
    },
    {
      instructions: "Tools in this MCP server only target the active Lfcode side browser tab.",
    },
  )

  server.registerTool(
    "browser_get_state",
    {
      description: "Get the current active Lfcode side browser target.",
    },
    async () => {
      const target = requireBridge().getActiveTarget()
      if (!target) throw new Error("No active Lfcode side browser tab")
      return result(`Active side browser: ${target.title || "<untitled>"} ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_navigate",
    {
      description: "Navigate the active Lfcode side browser tab to a URL.",
      inputSchema: {
        url: z.string(),
      },
    },
    async ({ url }) => {
      const target = await requireBridge().navigate({ url })
      return result(`Navigated side browser to ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_snapshot",
    {
      description: "Capture a structured snapshot of interactive elements from the active Lfcode side browser tab.",
    },
    async () => {
      const snapshot = await requireBridge().snapshot()
      return result(snapshot.text, snapshot)
    },
  )

  server.registerTool(
    "browser_click",
    {
      description: "Click an element from the latest browser_snapshot result by ref, such as e3.",
      inputSchema: {
        ref: z.string(),
      },
    },
    async ({ ref }) => {
      const target = await requireBridge().click({ ref })
      return result(`Clicked ${ref} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_type",
    {
      description: "Type into an element from the latest browser_snapshot result by ref.",
      inputSchema: {
        ref: z.string(),
        text: z.string(),
        submit: z.boolean().optional(),
      },
    },
    async ({ ref, text, submit }) => {
      const target = await requireBridge().type({ ref, text, submit })
      return result(`Typed into ${ref}${submit ? " and submitted" : ""} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_press_key",
    {
      description: "Press a key in the active Lfcode side browser tab.",
      inputSchema: {
        key: z.string(),
      },
    },
    async ({ key }) => {
      const target = await requireBridge().pressKey({ key })
      return result(`Pressed ${key} on ${target.url}`, target)
    },
  )

  server.registerTool(
    "browser_wait_for",
    {
      description: "Wait for text to appear, text to disappear, or a fixed delay in the active side browser tab.",
      inputSchema: {
        text: z.string().optional(),
        textGone: z.string().optional(),
        time: z.number().int().nonnegative().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ text, textGone, time, timeoutMs }) => {
      const target = await requireBridge().waitFor({
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

function requireBridge() {
  const bridge = getDesktopBrowserAutomationBridge()
  if (bridge) return bridge
  throw new Error("Lfcode desktop side browser automation is unavailable in this runtime")
}

function result(
  text: string,
  structuredContent?: DesktopBrowserAutomationTarget | DesktopBrowserAutomationSnapshot | DesktopBrowserAutomationWaitResult,
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
