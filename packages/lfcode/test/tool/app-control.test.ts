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
import {
  allowBrowserNavigation,
  browserSessionKey,
  resetBrowserNavigationAuthorizations,
} from "../../src/server/routes/browser-session-authorization"
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
  resetBrowserNavigationAuthorizations()
  await Instance.disposeAll()
})

describe("app control tools", () => {
  it.live("browser defaults to Lfcode's background embedded-browser channel", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const current = yield* session.create()
        const ctx = { ...baseCtx, sessionID: current.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "POST" && request.url.pathname === "/browser/open") return { ok: true, data: { opened: true } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-tool-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: false, permission: "session_control", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            return yield* browser.execute({ operation: "open", url: "https://example.com" }, ctx)
          }),
        )

        expect(JSON.parse(result.output)).toMatchObject({ opened: true })
        expect(result.metadata).toMatchObject({ operation: "open", presentation: "headless" })
        expect(received).toHaveLength(1)
        expect(received[0]?.body).toMatchObject({
          url: "https://example.com",
          presentation: "headless",
          sessionKey: browserSessionKey({ directory: current.directory, sessionID: current.id }),
        })
      }),
    ),
  )

  it.live("read-only app control exposes aggregate tools instead of granular app controls", () =>
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
        expect(ids.has("app_control")).toBe(true)
        expect(ids.has("browser")).toBe(true)
        for (const id of [
          "app_get_state",
          "app_list_windows",
          "app_get_events",
          "app_get_automation_status",
          "app_wait_for_event",
          "app_capture_window",
          "app_capture_diagnostics_bundle",
          "app_wait_for_state",
          "app_open_browser",
          "app_browser_snapshot",
          "app_read_browser_page",
          "app_open_route",
          "app_open_session",
          "app_open_side_chat",
          "app_focus_side_chat",
          "app_close_side_chat",
          "app_set_input",
          "app_append_input",
          "app_send",
        ]) {
          expect(ids.has(id)).toBe(false)
        }
      }),
    ),
  )

  it.live("does not reintroduce removed app or browser tools through an allowlist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        yield* config.saveGlobalAppControl({
          enabled: true,
          permission: "full_app_control",
          browser: { enabled: true, permission: "interactive" },
        })
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: {
            ...general,
            name: "removed-app-control-fixture",
            toolAllowlist: ["app_dom", "app_browser_snapshot"],
          },
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(ids.has("app_dom")).toBe(false)
        expect(ids.has("app_browser_snapshot")).toBe(false)
        expect(ids.has("app_control")).toBe(true)
        expect(ids.has("browser")).toBe(true)
      }),
    ),
  )

  it.live("app control registry and execution both ignore project-level permission overrides", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const { port, received } = yield* Effect.acquireRelease(
            Effect.promise(() =>
              startStubServer((request) => {
                if (request.method === "GET" && request.url.pathname === "/diagnostics/ui-state") {
                  return { ok: true, data: { route: "/" } }
                }
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }),
            ),
            (server) => Effect.promise(() => server.close()),
          )
          yield* withAutomationEnv(port, "global-app-control-token", () =>
            Effect.gen(function* () {
              const registry = yield* ToolRegistry.Service
              const agent = yield* Agent.Service
              const config = yield* Config.Service
              yield* config.saveGlobalAppControl({ enabled: true, permission: "read_only" })
              const general = yield* agent.get("general")
              if (!general) throw new Error("general agent not found")

              const initiallyVisible = yield* registry.tools({
                providerID: ProviderID.make("test"),
                modelID: ModelID.make("test-model"),
                agent: general,
              })
              const appControl = initiallyVisible.find((tool) => tool.id === "app_control")
              if (!appControl) throw new Error("app_control should be visible with global read-only access")

              const forwarded = yield* appControl.execute({ operation: "get_state", input: {} }, baseCtx)
              expect(JSON.parse(forwarded.output)).toMatchObject({ route: "/" })

              yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only" })
              const hidden = yield* registry.tools({
                providerID: ProviderID.make("test"),
                modelID: ModelID.make("test-model"),
                agent: general,
              })
              expect(hidden.some((tool) => tool.id === "app_control")).toBe(false)

              const exit = yield* Effect.exit(appControl.execute({ operation: "get_state", input: {} }, baseCtx))
              expect(exit._tag).toBe("Failure")
              expect(String(exit)).toContain("App Control is disabled in global settings")
            }),
          )
          expect(received).toHaveLength(1)
        }),
      {
        config: {
          app_control: {
            enabled: true,
            permission: "full_app_control",
          },
        },
      },
    ),
  )

  it.live("browser control stays independent when app control is disabled", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        yield* config.saveGlobalAppControl({
          enabled: false,
          permission: "session_control",
          browser: { enabled: true, permission: "interactive" },
        })
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("minimax-cn-coding-plan"),
          modelID: ModelID.make("MiniMax-M3"),
          agent: general,
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(ids.has("browser")).toBe(true)
        expect(ids.has("app_open_route")).toBe(false)

        const openBrowser = tools.find((tool) => tool.id === "browser")
        if (!openBrowser) throw new Error("browser tool not found")
        const exit = yield* Effect.exit(openBrowser.execute({ operation: "open", url: "https://example.com" }, baseCtx))
        expect(exit._tag).toBe("Failure")
        expect(String(exit)).toContain("No running desktop automation service")
        expect(String(exit)).toContain("automation_service_unavailable")
      }),
    ),
  )

  it.live("browser open authorizes each user session without a repeated confirmation", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const current = yield* session.create()
        const other = yield* session.create()
        const ctx = { ...baseCtx, sessionID: current.id }
        const otherCtx = { ...baseCtx, sessionID: other.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "GET" && request.url.pathname === "/browser/target") {
                return { ok: true, data: null }
              }
              if (request.method === "POST" && request.url.pathname === "/browser/open") {
                return { ok: true, data: { opened: true } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-open-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: false, permission: "session_control", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "browser")
            if (!tool) throw new Error("browser tool not found")
            return {
              initial: yield* tool.execute({ operation: "open", url: "https://example.com" }, ctx),
              repeated: yield* tool.execute({ operation: "open", url: "https://example.com" }, ctx),
              reused: yield* tool.execute({ operation: "open", url: "https://example.com/next" }, ctx),
              other: yield* tool.execute({ operation: "open", url: "https://example.com" }, otherCtx),
            }
          }),
        )

        const sessionKey = browserSessionKey({ directory: current.directory, sessionID: current.id })
        const otherSessionKey = browserSessionKey({ directory: other.directory, sessionID: other.id })
        expect(JSON.parse(result.initial.output)).toMatchObject({ opened: true })
        expect(result.repeated.metadata.sessionKey).toBe(sessionKey)
        expect(result.reused.metadata.sessionKey).toBe(sessionKey)
        expect(JSON.parse(result.other.output)).toMatchObject({ opened: true })
        expect(allowBrowserNavigation({ sessionKey, hasTarget: false })).toBe(true)
        expect(allowBrowserNavigation({ sessionKey: otherSessionKey, hasTarget: false })).toBe(true)
        expect(received.map((item) => item.url.pathname)).toEqual([
          "/browser/open",
          "/browser/open",
          "/browser/open",
          "/browser/open",
        ])
        expect(received[0]?.headers.authorization).toBe("Bearer browser-open-token")
        expect(received.map((item) => item.body)).toEqual([
          expect.objectContaining({ sessionKey }),
          expect.objectContaining({ sessionKey }),
          expect.objectContaining({ sessionKey }),
          expect.objectContaining({ sessionKey: otherSessionKey }),
        ])
      }),
    ),
  )

  it.live("browser preserves explicit session keys while sending the default canonical key", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const current = yield* session.create()
        const ctx = { ...baseCtx, sessionID: current.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "POST" && request.url.pathname === "/browser/open") return { ok: true, data: { opened: true } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-explicit-session-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            return yield* browser.execute(
              { operation: "open", url: "https://example.com", session_key: "explicit/session-key" },
              ctx,
            )
          }),
        )

        expect(received[0]?.body).toMatchObject({ sessionKey: "explicit/session-key" })
        expect(result.metadata.sessionKey).toBe("explicit/session-key")
      }),
    ),
  )

  it.live("legacy browser-control permission migrates to independent browser control", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        const saved = yield* config.saveGlobalAppControl({
          enabled: true,
          permission: "browser_control",
          browser: { enabled: true, permission: "interactive" },
        })
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(saved.permission).toBe("session_control")
        expect(saved.browser).toEqual({ enabled: true, permission: "interactive" })
        expect(saved.config.app_control).toEqual({ enabled: true, permission: "session_control" })
        expect(saved.config.browser_control).toEqual({ enabled: true, permission: "interactive" })
        expect(ids.has("browser")).toBe(true)
        expect(ids.has("app_control")).toBe(true)
        expect(ids.has("app_open_route")).toBe(false)
        expect(ids.has("app_open_session")).toBe(false)
        expect(ids.has("app_focus_side_chat")).toBe(false)
        expect(ids.has("app_close_side_chat")).toBe(false)
        expect(ids.has("app_append_input")).toBe(false)
        expect(ids.has("app_send")).toBe(false)
      }),
    ),
  )

  it.live("uses maximum independent defaults and preserves explicit browser overrides", () =>
    Effect.sync(() => {
      expect(Config.resolveGlobalAppControlConfig(undefined)).toEqual({
        enabled: true,
        permission: "full_app_control",
      })
      expect(Config.resolveGlobalBrowserControlConfig(undefined)).toEqual({
        enabled: true,
        permission: "interactive",
      })

      const legacy = {
        app_control: {
          enabled: false,
          permission: "full_app_control",
        },
      } as Config.Info
      expect(Config.resolveGlobalBrowserControlConfig(legacy)).toEqual({
        enabled: false,
        permission: "interactive",
      })
      expect(
        Config.resolveGlobalBrowserControlConfig({
          ...legacy,
          browser_control: {
            enabled: true,
            permission: "read_only",
          },
        }),
      ).toEqual({
        enabled: true,
        permission: "read_only",
      })
    }),
  )

  it.live("browser permission errors are actionable without depending on app control", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = yield* Agent.Service
        const config = yield* Config.Service
        const general = yield* agent.get("general")
        if (!general) throw new Error("general agent not found")
        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        const browser = tools.find((item) => item.id === "browser")
        if (!browser) throw new Error("browser tool not found")

        yield* config.saveGlobalAppControl({
          enabled: false,
          permission: "read_only",
          browser: { enabled: false, permission: "interactive" },
        })
        const disabled = yield* Effect.exit(browser.execute({ operation: "read" }, baseCtx))
        expect(disabled._tag).toBe("Failure")
        expect(String(disabled)).toContain("browser_control_disabled")
        expect(String(disabled)).toContain("Settings > App Control > Built-in browser control")

        yield* config.saveGlobalAppControl({
          enabled: false,
          permission: "read_only",
          browser: { enabled: true, permission: "read_only" },
        })
        const denied = yield* Effect.exit(browser.execute({ operation: "click", ref: "button:save" }, baseCtx))
        expect(denied._tag).toBe("Failure")
        expect(String(denied)).toContain("browser_permission_denied")
        expect(String(denied)).toContain("change the permission to Interactive")
      }),
    ),
  )

  it.live("aggregate window listing and route navigation normalize payloads", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            yield* appControl.execute({ operation: "list_windows", input: {} }, baseCtx)
            return yield* appControl.execute({ operation: "open_route", input: { route: "/settings", window_id: 4 } }, baseCtx)
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            yield* appControl.execute(
              { operation: "focus_side_chat", input: { session_id: "ses_side_1", window_id: 2 } },
              baseCtx,
            )
            yield* appControl.execute(
              { operation: "close_side_chat", input: { session_id: "ses_side_1", window_id: 2 } },
              baseCtx,
            )
            return yield* appControl.execute(
              {
                operation: "append_input",
                input: { text: " world", target: "active_side", session_id: "ses_side_1", window_id: 2 },
              },
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

  it.live("aggregate diagnostics events query forwards filters", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            return yield* appControl.execute(
              {
                operation: "get_events",
                input: {
                  scope: "renderer",
                  type: "sidechat.opened",
                  limit: 5,
                },
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

  it.live("aggregate automation status and cursor events use authenticated protocol endpoints", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "GET" && request.url.pathname === "/meta") {
                return {
                  ok: true,
                  data: {
                    protocolVersion: 2,
                    instanceID: "desktop-instance-1",
                    pid: 1234,
                    startedAt: 1_700_000_000_000,
                    version: "1.2.3",
                    capability: "full_app_control",
                    features: ["diagnostics.events.cursor"],
                  },
                }
              }
              if (request.method === "GET" && request.url.pathname === "/diagnostics/events/next") {
                return {
                  ok: true,
                  data: {
                    events: [
                      {
                        id: 42,
                        at: 1_700_000_000_100,
                        timestamp: 1_700_000_000_100,
                        isoTime: "2023-11-14T22:13:20.100Z",
                        scope: "renderer",
                        type: "session.updated",
                      },
                    ],
                    nextCursor: 42,
                    oldestID: 40,
                    latestID: 42,
                    resetRequired: false,
                  },
                }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "status-and-cursor-token", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            return {
              status: yield* appControl.execute({ operation: "get_automation_status", input: {} }, baseCtx),
              wait: yield* appControl.execute(
                {
                  operation: "wait_for_event",
                  input: {
                    after: 41,
                    scope: "renderer",
                    type: "session.updated",
                    limit: 3,
                    wait_ms: 250,
                  },
                },
                baseCtx,
              ),
            }
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/meta", "/diagnostics/events/next"])
        expect(received.map((item) => item.headers.authorization)).toEqual([
          "Bearer status-and-cursor-token",
          "Bearer status-and-cursor-token",
        ])
        expect(received[1]?.url.search).toBe("?after=41&scope=renderer&type=session.updated&limit=3&waitMs=250")
        expect(result.status.title).toBe("Read desktop automation status")
        expect(result.status.metadata).toMatchObject({
          protocolVersion: 2,
          instanceID: "desktop-instance-1",
          capability: "full_app_control",
        })
        expect(JSON.parse(result.wait.output)).toMatchObject({ nextCursor: 42, resetRequired: false })
        expect(result.wait.metadata).toMatchObject({ after: 41, waitMs: 250 })
      }),
    ),
  )

  it.live("aggregate wait_for_state normalizes wait match payload before posting", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            return yield* appControl.execute(
              {
                operation: "wait_for_state",
                input: {
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

  it.live("aggregate capture_window posts capture request and returns saved path", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            return yield* appControl.execute(
              {
                operation: "capture_window",
                input: {
                  window_id: 9,
                  label: "goal-run",
                },
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

  it.live("browser read falls back to the current session key", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "browser")
            if (!tool) throw new Error("browser tool not found")
            return yield* tool.execute({ operation: "read" }, ctx)
          }),
        )

        expect(received.length).toBe(1)
        expect(received[0]?.headers.authorization).toBe("Bearer browser-read-token")
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
        })
        expect(result.metadata.sessionKey).toBe(browserSessionKey({ directory: info.directory, sessionID: info.id }))
      }),
    ),
  )

  it.live("browser target errors retain an actionable desktop recovery", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method !== "POST" || request.url.pathname !== "/browser/read-page") {
                throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
              }
              return {
                ok: false,
                error: "No active side browser tab exists for this session.",
                code: "browser_target_missing",
                retryable: false,
                recovery: "Open or bind a side browser tab for this session, then retry.",
              }
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const exit = yield* withAutomationEnv(port, "browser-target-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({
              enabled: false,
              permission: "read_only",
              browser: { enabled: true, permission: "interactive" },
            })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            return yield* Effect.exit(browser.execute({ operation: "read", session_key: "dir/ses_missing" }, baseCtx))
          }),
        )

        expect(exit._tag).toBe("Failure")
        expect(String(exit)).toContain("browser_target_missing")
        expect(String(exit)).toContain("Open or bind a side browser tab")
      }),
    ),
  )

  it.live("unified browser tool normalizes click/type/wait payloads", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            yield* browser.execute({ operation: "click", session_key: "dir/ses_1", ref: "button:login" }, baseCtx)
            yield* browser.execute({ operation: "click", session_key: "dir/ses_1", selector: "[data-action=save]" }, baseCtx)
            yield* browser.execute({ operation: "type", session_key: "dir/ses_1", ref: "input:query", text: "lfcode", submit: true }, baseCtx)
            yield* browser.execute({ operation: "wait", session_key: "dir/ses_1", text: "Done", text_gone: "Loading", time_ms: 50, timeout_ms: 1000 }, baseCtx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/click", "/browser/click", "/browser/type", "/browser/wait"])
        expect(received[0]?.body).toEqual({
          sessionKey: "dir/ses_1",
          ref: "button:login",
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/ses_1",
          selector: "[data-action=save]",
        })
        expect(received[2]?.body).toEqual({
          sessionKey: "dir/ses_1",
          ref: "input:query",
          text: "lfcode",
          submit: true,
        })
        expect(received[3]?.body).toEqual({
          sessionKey: "dir/ses_1",
          text: "Done",
          textGone: "Loading",
          timeMs: 50,
          timeoutMs: 1000,
        })
      }),
    ),
  )

  it.live("unified browser tool normalizes console and network payloads", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            yield* browser.execute({ operation: "console", limit: 15 }, ctx)
            yield* browser.execute({ operation: "network", session_key: "dir/custom", limit: 9 }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/console", "/browser/network"])
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
          limit: 15,
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          limit: 9,
        })
      }),
    ),
  )

  it.live("unified browser tool normalizes screenshot and resource extraction payloads", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            yield* browser.execute({ operation: "screenshot" }, ctx)
            yield* browser.execute({ operation: "extract_resource", session_key: "dir/custom", selector: "img.hero" }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/screenshot", "/browser/extract-resource"])
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
        })
        expect(received[1]?.body).toEqual({
          sessionKey: "dir/custom",
          selector: "img.hero",
          ref: undefined,
        })
      }),
    ),
  )

  it.live("unified browser tool exposes browser history navigation", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/back") return { ok: true, data: { url: "https://example.com/previous" } }
              if (request.url.pathname === "/browser/forward") return { ok: true, data: { url: "https://example.com/current" } }
              if (request.url.pathname === "/browser/reload") return { ok: true, data: { url: "https://example.com/current" } }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        yield* withAutomationEnv(port, "browser-navigation-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            yield* browser.execute({ operation: "back" }, ctx)
            yield* browser.execute({ operation: "forward", session_key: "dir/custom" }, ctx)
            yield* browser.execute({ operation: "reload" }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/back", "/browser/forward", "/browser/reload"])
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
        })
        expect(received[1]?.body).toEqual({ sessionKey: "dir/custom" })
        expect(received[2]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
        })
      }),
    ),
  )

  it.live("unified browser tool normalizes snapshot and scroll payloads", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            yield* browser.execute({ operation: "snapshot" }, ctx)
            yield* browser.execute({ operation: "scroll", session_key: "dir/custom", selector: ".timeline", direction: "down", amount: 320 }, ctx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/snapshot", "/browser/scroll"])
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
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

  it.live("unified browser tool normalizes close and resource download payloads", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/close") return { ok: true }
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            const closed = yield* browser.execute({ operation: "close" }, ctx)
            expect(closed.output).toBe("null")
            yield* browser.execute(
              { operation: "download_resource", session_key: "dir/custom", selector: "img.hero", filename: "hero.png" },
              ctx,
            )
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/close", "/browser/download-resource"])
        expect(received[0]?.body).toEqual({
          sessionKey: browserSessionKey({ directory: info.directory, sessionID: info.id }),
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

  it.live("unified browser tool normalizes tab focus payloads", () =>
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
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const tool = tools.find((item) => item.id === "browser")
            if (!tool) throw new Error("browser tool not found")
            return yield* tool.execute({ operation: "focus_tab", session_key: "dir/custom", tab_id: "b_demo", window_id: 6 }, baseCtx)
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/browser/focus-tab"])
        expect(received[0]?.body).toEqual({
          sessionKey: "dir/custom",
          windowID: 6,
          tabID: "b_demo",
        })
        expect(result.title).toBe("Focused side browser tab")
      }),
    ),
  )

  it.live("unified browser tool supports semantic waits, assertions, tab handles, and element controls", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create()
        const ctx = { ...baseCtx, sessionID: info.id }
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.url.pathname === "/browser/open") {
                const body = request.body as { newTab?: boolean } | undefined
                return { ok: true, data: { target: { tabID: body?.newTab ? "b_two" : "b_one" } } }
              }
              if (request.url.pathname === "/browser/wait-selector") return { ok: true, data: { matched: true, detail: "selector matched" } }
              if (request.url.pathname === "/browser/wait-url") return { ok: true, data: { matched: true, detail: "URL matched" } }
              if (request.url.pathname === "/browser/wait-load-state") return { ok: true, data: { matched: true, detail: "load matched" } }
              if (request.url.pathname === "/browser/wait-navigation") return { ok: true, data: { matched: true, detail: "navigation matched" } }
              if (request.url.pathname === "/browser/read-page") {
                return {
                  ok: true,
                  data: {
                    title: "Example",
                    url: "https://example.com/ready",
                    text: "Ready content",
                    target: { tabID: "b_one" },
                  },
                }
              }
              if (request.url.pathname === "/browser/console") return { ok: true, data: { entries: [] } }
              if (request.url.pathname === "/browser/network") {
                return {
                  ok: true,
                  data: {
                    entries: [
                      { url: "https://example.com/ready", method: "GET", error: "net::ERR_ABORTED", time: Date.now() - 20 },
                      { url: "https://example.com/ready", method: "GET", statusCode: 200, time: Date.now() },
                    ],
                  },
                }
              }
              if (request.url.pathname === "/browser/clear") return { ok: true, data: { tabID: "b_one" } }
              if (request.url.pathname === "/browser/select-option") return { ok: true, data: { tabID: "b_one" } }
              if (request.url.pathname === "/browser/upload-file") return { ok: true, data: { tabID: "b_one" } }
              if (request.url.pathname === "/browser/capture-element") {
                return {
                  ok: true,
                  data: {
                    target: { tabID: "b_one" },
                    selector: ".dialog",
                    path: "C:/tmp/dialog.png",
                    width: 640,
                    height: 420,
                    viewport: { width: 1280, height: 800 },
                    deviceScaleFactor: 1,
                  },
                }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )
        const result = yield* withAutomationEnv(port, "browser-unified-upgrade-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: false, permission: "read_only", browser: { enabled: true, permission: "interactive" } })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({ providerID: ProviderID.make("test"), modelID: ModelID.make("test-model"), agent: general })
            const browser = tools.find((item) => item.id === "browser")
            if (!browser) throw new Error("browser tool not found")
            const opened = yield* browser.execute({ operation: "open", url: "https://example.com/ready" }, ctx)
            expect(opened.metadata).toMatchObject({ tabID: "b_one" })
            const navigated = yield* browser.execute({ operation: "navigate", tab_id: "b_one", url: "https://www.iana.org/help" }, ctx)
            expect(navigated.title).toBe("Navigated browser test target")
            expect(navigated.metadata).toMatchObject({ operation: "navigate", tabID: "b_one" })
            yield* browser.execute({ operation: "wait_for_selector", tab_id: "b_one", selector: ".dialog", visible: true, timeout_ms: 500 }, ctx)
            yield* browser.execute({ operation: "wait_for_url", tab_id: "b_one", url: "https://example.com", match: "includes" }, ctx)
            yield* browser.execute({ operation: "wait_for_load_state", tab_id: "b_one", state: "load", stable_ms: 50 }, ctx)
            yield* browser.execute({ operation: "wait_for_navigation", tab_id: "b_one", url: "ready", match: "includes" }, ctx)
            const assertions = yield* browser.execute({
              operation: "assert",
              tab_id: "b_one",
              checks: [
                { kind: "url", expected: "example.com", match: "includes" },
                { kind: "title", expected: "Example" },
                { kind: "text", expected: "Ready content", match: "contains" },
                { kind: "selector", selector: ".dialog" },
                { kind: "console", mode: "has_no_error" },
                { kind: "network", mode: "has_no_failed_request" },
              ],
            }, ctx)
            expect(JSON.parse(assertions.output)).toMatchObject({ passed: true })
            const nestedIncludes = yield* browser.execute({
              operation: "assert",
              tab_id: "b_one",
              check: { kind: "text", expected: "Ready content", match: "includes" },
            }, ctx)
            expect(JSON.parse(nestedIncludes.output)).toMatchObject({ passed: true })
            const second = yield* browser.execute({ operation: "open", url: "https://httpbin.org/forms/post", new_tab: true }, ctx)
            expect(second.metadata).toMatchObject({ tabID: "b_two" })
            yield* browser.execute({ operation: "clear", tab_id: "b_one", selector: "input[name=q]" }, ctx)
            yield* browser.execute({ operation: "select_option", tab_id: "b_one", selector: "select[name=mode]", label: "Fast" }, ctx)
            yield* browser.execute({ operation: "upload_file", tab_id: "b_one", selector: "input[type=file]", files: ["fixture.txt"] }, ctx)
            const capture = yield* browser.execute({ operation: "capture_element", tab_id: "b_one", selector: ".dialog" }, ctx)
            expect(JSON.parse(capture.output)).toMatchObject({ width: 640, height: 420, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
          }),
        )

        const paths = received.map((item) => item.url.pathname)
        expect(paths.filter((path) => path === "/browser/wait-selector")).toHaveLength(2)
        expect(paths).toEqual(expect.arrayContaining([
          "/browser/open",
          "/browser/wait-url",
          "/browser/wait-load-state",
          "/browser/wait-navigation",
          "/browser/read-page",
          "/browser/console",
          "/browser/network",
          "/browser/clear",
          "/browser/select-option",
          "/browser/upload-file",
          "/browser/capture-element",
        ]))
        expect(received.find((item) => item.url.pathname === "/browser/clear")?.body).toMatchObject({ sessionKey: expect.any(String), tabID: "b_one", selector: "input[name=q]" })
        expect(received.find((item) => item.url.pathname === "/browser/wait-load-state")?.body).toMatchObject({ tabID: "b_one", state: "load", stableMs: 50 })
        expect(received.find((item) => item.url.pathname === "/browser/open" && (item.body as { newTab?: boolean })?.newTab)?.body).toMatchObject({ newTab: true })
        expect(received.find((item) => item.url.pathname === "/browser/open" && (item.body as { url?: string })?.url === "https://www.iana.org/help")?.body).toMatchObject({ tabID: "b_one" })
      }),
    ),
  )

  it.live("aggregate diagnostics bundle combines UI state, events, and screenshot", () =>
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
            const appControl = tools.find((item) => item.id === "app_control")
            if (!appControl) throw new Error("app_control not found")
            return yield* appControl.execute(
              {
                operation: "capture_diagnostics_bundle",
                input: {
                  window_id: 5,
                  label: "bundle",
                  event_limit: 12,
                },
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
