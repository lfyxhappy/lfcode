import { afterEach, describe, expect } from "bun:test"
import { createServer } from "node:http"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import { Instance } from "../../src/project/instance"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Tool } from "../../src/tool"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Agent.defaultLayer,
    Config.defaultLayer,
    Session.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const baseCtx: Tool.Context = {
  sessionID: SessionID.make("ses_app_control"),
  messageID: MessageID.make("msg_app_control"),
  callID: "call_app_control",
  agent: "general",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("app control tools", () => {
  it.live("read-only app control exposes diagnostics tools but hides write actions", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(ids.has("app_get_state")).toBe(true)
        expect(ids.has("app_list_windows")).toBe(true)
        expect(ids.has("app_get_events")).toBe(true)
        expect(ids.has("app_capture_window")).toBe(true)
        expect(ids.has("app_capture_diagnostics_bundle")).toBe(true)
        expect(ids.has("app_wait_for_state")).toBe(true)
        expect(ids.has("app_get_console")).toBe(false)
        expect(ids.has("app_get_network")).toBe(false)
        expect(ids.has("app_open_browser")).toBe(false)
        expect(ids.has("app_browser_snapshot")).toBe(false)
        expect(ids.has("app_read_browser_page")).toBe(false)
        expect(ids.has("app_browser_download_resource")).toBe(false)
        expect(ids.has("app_focus_browser_tab")).toBe(false)
        expect(ids.has("app_browser_click")).toBe(false)
        expect(ids.has("app_browser_scroll")).toBe(false)
        expect(ids.has("app_browser_type")).toBe(false)
        expect(ids.has("app_browser_wait")).toBe(false)
        expect(ids.has("app_close_browser_tab")).toBe(false)
        expect(ids.has("app_open_route")).toBe(false)
        expect(ids.has("app_open_session")).toBe(false)
        expect(ids.has("app_open_side_chat")).toBe(false)
        expect(ids.has("app_focus_side_chat")).toBe(false)
        expect(ids.has("app_close_side_chat")).toBe(false)
        expect(ids.has("app_set_input")).toBe(false)
        expect(ids.has("app_append_input")).toBe(false)
        expect(ids.has("app_send")).toBe(false)
      }),
    ),
  )

  it.live("browser-control app control exposes browser tools without full app control", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(ids.has("app_open_browser")).toBe(true)
        expect(ids.has("app_browser_snapshot")).toBe(true)
        expect(ids.has("app_get_console")).toBe(true)
        expect(ids.has("app_get_network")).toBe(true)
        expect(ids.has("app_read_browser_page")).toBe(true)
        expect(ids.has("app_browser_screenshot")).toBe(true)
        expect(ids.has("app_browser_extract_resource")).toBe(true)
        expect(ids.has("app_browser_download_resource")).toBe(true)
        expect(ids.has("app_focus_browser_tab")).toBe(true)
        expect(ids.has("app_browser_click")).toBe(true)
        expect(ids.has("app_browser_scroll")).toBe(true)
        expect(ids.has("app_browser_type")).toBe(true)
        expect(ids.has("app_browser_wait")).toBe(true)
        expect(ids.has("app_close_browser_tab")).toBe(true)
        expect(ids.has("app_open_route")).toBe(true)
        expect(ids.has("app_open_session")).toBe(true)
        expect(ids.has("app_focus_side_chat")).toBe(true)
        expect(ids.has("app_close_side_chat")).toBe(true)
        expect(ids.has("app_append_input")).toBe(true)
        expect(ids.has("app_send")).toBe(true)
      }),
    ),
  )

  it.live("read-only window listing and route navigation tools normalize payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "GET" && request.url.pathname === "/windows") {
                return { ok: true, data: [{ id: 1, title: "Lfcode", focused: true }] }
              }
              if (request.method === "POST" && request.url.pathname === "/route/navigate") {
                return { ok: true, data: { route: "/settings", changed: true } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "windows-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "session_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const listWindows = tools.find((item) => item.id === "app_list_windows")
            const openRoute = tools.find((item) => item.id === "app_open_route")
            if (!listWindows || !openRoute) throw new Error("window/route tools not found")
            yield* listWindows.execute({}, baseCtx)
            return yield* openRoute.execute({ route: "/settings", window_id: 4 }, baseCtx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/windows", "/route/navigate"])
        expect(received[1]?.body).toEqual({
          windowID: 4,
          route: "/settings",
        })
        expect(result.title).toBe("Opened desktop route")
        expect(result.metadata.route).toBe("/settings")
      }),
    ),
  )

  it.live("side chat focus/close and composer append normalize payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "POST" && request.url.pathname === "/sidechat/open") {
                return { ok: true, data: { sideSessionID: "ses_side_1" } }
              }
              if (request.method === "POST" && request.url.pathname === "/sidechat/close") {
                return { ok: true, data: { closed: true } }
              }
              if (request.method === "POST" && request.url.pathname === "/composer/set-text") {
                return { ok: true, data: { target: "active-side", text: "hello world" } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "sidechat-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "session_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const focusTool = tools.find((item) => item.id === "app_focus_side_chat")
            const closeTool = tools.find((item) => item.id === "app_close_side_chat")
            const appendTool = tools.find((item) => item.id === "app_append_input")
            if (!focusTool || !closeTool || !appendTool) throw new Error("side chat tools not found")
            yield* focusTool.execute({ session_id: "ses_side_1", window_id: 2 }, baseCtx)
            yield* closeTool.execute({ session_id: "ses_side_1", window_id: 2 }, baseCtx)
            return yield* appendTool.execute(
              { text: " world", target: "active_side", session_id: "ses_side_1", window_id: 2 },
              baseCtx,
            )
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual([
          "/sidechat/open",
          "/sidechat/close",
          "/composer/set-text",
        ])
        expect(received[0]?.body).toEqual({
          windowID: 2,
          sessionID: "ses_side_1",
        })
        expect(received[1]?.body).toEqual({
          windowID: 2,
          sessionID: "ses_side_1",
        })
        expect(received[2]?.body).toEqual({
          windowID: 2,
          text: " world",
          target: "active-side",
          sessionID: "ses_side_1",
          append: true,
        })
        expect(result.title).toBe("Appended app composer input")
      }),
    ),
  )

  it.live("app_get_events queries diagnostics events with filters", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, close, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method !== "GET" || request.url.pathname !== "/diagnostics/events") {
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }
              return {
                ok: true,
                data: [
                  {
                    id: 7,
                    scope: "renderer",
                    type: "sidechat.opened",
                  },
                ],
              }
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "test-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_get_events")
            if (!tool) throw new Error("app_get_events not found")
            return yield* tool.execute(
              {
                scope: "renderer",
                type: "sidechat.opened",
                limit: 5,
              },
              baseCtx,
            )
          }),
        )

        expect(received.length).toBe(1)
        expect(received[0]?.headers.authorization).toBe("Bearer test-token")
        expect(received[0]?.url.searchParams.get("scope")).toBe("renderer")
        expect(received[0]?.url.searchParams.get("type")).toBe("sidechat.opened")
        expect(received[0]?.url.searchParams.get("limit")).toBe("5")
        expect(result.title).toBe("Read desktop automation events")
        expect(JSON.parse(result.output)).toHaveLength(1)
      }),
    ),
  )

  it.live("app_wait_for_state normalizes wait match payload before posting", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, close, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method !== "POST" || request.url.pathname !== "/wait") {
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }
              return {
                ok: true,
                data: {
                  matched: true,
                  window: { id: 3 },
                  state: {
                    route: "/session/demo",
                  },
                },
              }
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "wait-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_wait_for_state")
            if (!tool) throw new Error("app_wait_for_state not found")
            return yield* tool.execute(
              {
                window_id: 3,
                timeout_ms: 1500,
                interval_ms: 60,
                match: {
                  route: "/session/demo",
                  session_id: "ses_side_1",
                  active_tab: "side-chat",
                  loading: false,
                  side_chat_count: 1,
                  browser_tab_count: 2,
                  composer_target: "active_side",
                },
              },
              baseCtx,
            )
          }),
        )

        expect(received.length).toBe(1)
        expect(received[0]?.headers.authorization).toBe("Bearer wait-token")
        expect(received[0]?.body).toEqual({
          windowID: 3,
          timeoutMs: 1500,
          intervalMs: 60,
          match: {
            route: "/session/demo",
            sessionID: "ses_side_1",
            activeTab: "side-chat",
            loading: false,
            sideChatCount: 1,
            browserTabCount: 2,
            composerTarget: "active-side",
          },
        })
        expect(result.title).toBe("App state matched")
        expect(result.metadata.matched).toBe(true)
      }),
    ),
  )

  it.live("app_capture_window posts capture request and returns saved path", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method !== "POST" || request.url.pathname !== "/capture/window") {
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }
              return {
                ok: true,
                data: {
                  path: "C:/tmp/app-window.png",
                  window: { id: 9 },
                  state: { route: "/session/demo" },
                },
              }
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "capture-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_capture_window")
            if (!tool) throw new Error("app_capture_window not found")
            return yield* tool.execute(
              {
                window_id: 9,
                label: "goal-run",
              },
              baseCtx,
            )
          }),
        )

        expect(received.length).toBe(1)
        expect(received[0]?.headers.authorization).toBe("Bearer capture-token")
        expect(received[0]?.body).toEqual({
          windowID: 9,
          label: "goal-run",
        })
        expect(result.title).toBe("Captured desktop window")
        expect(result.metadata.path).toBe("C:/tmp/app-window.png")
      }),
    ),
  )

  it.live("app_read_browser_page falls back to the current session key", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method !== "POST" || request.url.pathname !== "/browser/read-page") {
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }
              return {
                ok: true,
                data: {
                  url: "https://example.com",
                  title: "Example",
                  text: "hello",
                },
              }
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-read-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_read_browser_page")
            if (!tool) throw new Error("app_read_browser_page not found")
            return yield* tool.execute({}, ctx)
          }),
        )

        expect(received.length).toBe(1)
        expect(received[0]?.headers.authorization).toBe("Bearer browser-read-token")
        expect(received[0]?.body).toEqual({
          sessionKey: `${info.directory}/${info.id}`,
        })
        expect(result.metadata.sessionKey).toBe(`${info.directory}/${info.id}`)
      }),
    ),
  )

  it.live("browser tools normalize click/type/wait payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/click") return { ok: true, data: { clicked: true } }
              if (request.url.pathname === "/browser/type") return { ok: true, data: { typed: true } }
              if (request.url.pathname === "/browser/wait") return { ok: true, data: { matched: true } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-write-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const click = tools.find((item) => item.id === "app_browser_click")
            const type = tools.find((item) => item.id === "app_browser_type")
            const wait = tools.find((item) => item.id === "app_browser_wait")
            if (!click || !type || !wait) throw new Error("browser tools not found")
            yield* click.execute({ session_key: "dir/ses_1", ref: "button:login" }, baseCtx)
            yield* type.execute({ session_key: "dir/ses_1", ref: "input:query", text: "lfcode", submit: true }, baseCtx)
            yield* wait.execute({ session_key: "dir/ses_1", text: "Done", text_gone: "Loading", time_ms: 50, timeout_ms: 1000 }, baseCtx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/click", "/browser/type", "/browser/wait"])
        expect(received[0]?.body).toEqual({
          sessionKey: "dir/ses_1",
          ref: "button:login",
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/ses_1",
          ref: "input:query",
          text: "lfcode",
          submit: true,
        })
        expect(received[2]?.body).toEqual({
          sessionKey: "dir/ses_1",
          text: "Done",
          textGone: "Loading",
          timeMs: 50,
          timeoutMs: 1000,
        })
      }),
    ),
  )

  it.live("browser diagnostics tools normalize console and network payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/console") return { ok: true, data: [{ level: "log" }] }
              if (request.url.pathname === "/browser/network") return { ok: true, data: [{ url: "https://example.com" }] }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-diag-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const consoleTool = tools.find((item) => item.id === "app_get_console")
            const networkTool = tools.find((item) => item.id === "app_get_network")
            if (!consoleTool || !networkTool) throw new Error("diagnostic browser tools not found")
            yield* consoleTool.execute({ limit: 15 }, ctx)
            yield* networkTool.execute({ session_key: "dir/custom", limit: 9 }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/console", "/browser/network"])
        expect(received[0]?.body).toEqual({
          sessionKey: `${info.directory}/${info.id}`,
          limit: 15,
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          limit: 9,
        })
      }),
    ),
  )

  it.live("browser screenshot and resource extraction normalize payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/screenshot") return { ok: true, data: { path: "C:/tmp/browser.png" } }
              if (request.url.pathname === "/browser/extract-resource") return { ok: true, data: { url: "https://example.com/image.png" } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-resource-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const screenshotTool = tools.find((item) => item.id === "app_browser_screenshot")
            const resourceTool = tools.find((item) => item.id === "app_browser_extract_resource")
            if (!screenshotTool || !resourceTool) throw new Error("browser capture tools not found")
            yield* screenshotTool.execute({}, ctx)
            yield* resourceTool.execute({ session_key: "dir/custom", selector: "img.hero" }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/screenshot", "/browser/extract-resource"])
        expect(received[0]?.body).toEqual({
          sessionKey: `${info.directory}/${info.id}`,
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          selector: "img.hero",
          ref: undefined,
        })
      }),
    ),
  )

  it.live("browser snapshot and scroll normalize payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/snapshot") return { ok: true, data: { refs: [] } }
              if (request.url.pathname === "/browser/scroll") return { ok: true, data: { scrolled: true } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-snapshot-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const snapshotTool = tools.find((item) => item.id === "app_browser_snapshot")
            const scrollTool = tools.find((item) => item.id === "app_browser_scroll")
            if (!snapshotTool || !scrollTool) throw new Error("browser snapshot/scroll tools not found")
            yield* snapshotTool.execute({}, ctx)
            yield* scrollTool.execute({ session_key: "dir/custom", selector: ".timeline", direction: "down", amount: 320 }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/snapshot", "/browser/scroll"])
        expect(received[0]?.body).toEqual({
          sessionKey: `${info.directory}/${info.id}`,
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          ref: undefined,
          selector: ".timeline",
          direction: "down",
          amount: 320,
        })
      }),
    ),
  )

  it.live("browser close and resource download normalize payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/close") return { ok: true, data: { closed: true } }
              if (request.url.pathname === "/browser/download-resource") {
                return { ok: true, data: { url: "https://example.com/image.png", path: "C:/tmp/image.png", filename: "image.png" } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-download-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const closeTool = tools.find((item) => item.id === "app_close_browser_tab")
            const downloadTool = tools.find((item) => item.id === "app_browser_download_resource")
            if (!closeTool || !downloadTool) throw new Error("browser close/download tools not found")
            yield* closeTool.execute({}, ctx)
            yield* downloadTool.execute(
              { session_key: "dir/custom", selector: "img.hero", filename: "hero.png" },
              ctx,
            )
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/close", "/browser/download-resource"])
        expect(received[0]?.body).toEqual({
          sessionKey: `${info.directory}/${info.id}`,
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          url: undefined,
          filename: "hero.png",
          resourceID: undefined,
          ref: undefined,
          selector: "img.hero",
        })
      }),
    ),
  )

  it.live("browser tab focus normalizes payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/focus-tab") return { ok: true, data: { tabID: "b_demo" } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-focus-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "browser_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_focus_browser_tab")
            if (!tool) throw new Error("app_focus_browser_tab not found")
            return yield* tool.execute({ tab_id: "b_demo", window_id: 6 }, baseCtx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/focus-tab"])
        expect(received[0]?.body).toEqual({
          windowID: 6,
          tabID: "b_demo",
        })
        expect(result.title).toBe("Focused side browser tab")
      }),
    ),
  )

  it.live("app_capture_diagnostics_bundle combines ui state, events, and screenshot", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "GET" && request.url.pathname === "/diagnostics/ui-state") {
                return { ok: true, data: { state: { route: "/session/demo" } } }
              }
              if (request.method === "GET" && request.url.pathname === "/diagnostics/events") {
                return { ok: true, data: [{ type: "session.opened" }] }
              }
              if (request.method === "POST" && request.url.pathname === "/capture/window") {
                return { ok: true, data: { path: "C:/tmp/diag.png" } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "bundle-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "app_capture_diagnostics_bundle")
            if (!tool) throw new Error("app_capture_diagnostics_bundle not found")
            return yield* tool.execute(
              {
                window_id: 5,
                label: "bundle",
                event_limit: 12,
              },
              baseCtx,
            )
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual([
          "/diagnostics/ui-state",
          "/diagnostics/events",
          "/capture/window",
        ])
        expect(received[0]?.url.searchParams.get("windowID")).toBe("5")
        expect(received[1]?.url.searchParams.get("limit")).toBe("12")
        expect(received[2]?.body).toEqual({
          windowID: 5,
          label: "bundle",
        })
        expect(result.title).toBe("Captured desktop diagnostics bundle")
        expect(result.metadata.capturePath).toBe("C:/tmp/diag.png")
      }),
    ),
  )
})

function withAutomationEnv<A, E, R>(port: number, token: string, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = {
        host: process.env.LFCODE_AUTOMATION_HOST,
        port: process.env.LFCODE_AUTOMATION_PORT,
        token: process.env.LFCODE_AUTOMATION_TOKEN,
      }
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = token
      return previous
    }),
    () => fx(),
    (previous) =>
      Effect.sync(() => {
        restoreEnv("LFCODE_AUTOMATION_HOST", previous.host)
        restoreEnv("LFCODE_AUTOMATION_PORT", previous.port)
        restoreEnv("LFCODE_AUTOMATION_TOKEN", previous.token)
      }),
  )
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function startStubServer(
  respond: (input: {
    method: string
    url: URL
    headers: Record<string, string | undefined>
    body?: unknown
  }) => Record<string, unknown>,
) {
  const received: Array<{
    method: string
    url: URL
    headers: Record<string, string | undefined>
    body?: unknown
  }> = []
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const headers = {
      authorization: request.headers.authorization,
      "content-type": request.headers["content-type"],
    }
    received.push({
      method: request.method ?? "GET",
      url,
      headers,
      body,
    })
    const payload = respond({
      method: request.method ?? "GET",
      url,
      headers,
      body,
    })
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    response.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const port = (server.address() as { port: number }).port
  return {
    port,
    received,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return undefined
  return JSON.parse(text) as unknown
}
