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
import { AppDomTool } from "../../src/tool/app_dom"
import { defaultLayer } from "../../src/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Agent.defaultLayer,
    Config.defaultLayer,
    Session.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    defaultLayer,
  ),
)

const baseCtx: Tool.Context = {
  sessionID: SessionID.make("ses_app_dom_ui"),
  messageID: MessageID.make("msg_app_dom_ui"),
  callID: "call_app_dom_ui",
  agent: "general",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("app DOM and UI semantic tools", () => {
  it.live("forwards versioned DOM snapshots, target states, and the UI catalog", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { port, received } = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startStubServer((request) => {
              if (request.method === "GET" && request.url.pathname === "/dom/snapshot") {
                return { ok: true, data: { snapshotID: "s1", revision: 4, windowID: 7 } }
              }
              if (request.method === "POST" && request.url.pathname === "/dom/act") {
                return { ok: true, data: { action: "setChecked", changed: true, windowID: 7 } }
              }
              if (request.method === "GET" && request.url.pathname === "/ui/catalog") {
                return { ok: true, data: { windowID: 7, catalog: [] } }
              }
              if (request.method === "POST" && request.url.pathname === "/ui/click") {
                return { ok: true, data: { token: "settings.toggle", windowID: 7 } }
              }
              throw new Error(`Unexpected request: ${request.method} ${request.url.pathname}`)
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        )

        yield* withAutomationEnv(port, "app-dom-ui-token", () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const agent = yield* Agent.Service
            const config = yield* Config.Service
            yield* config.saveGlobalAppControl({ enabled: true, permission: "full_app_control" })
            const general = yield* agent.get("general")
            if (!general) throw new Error("general agent not found")
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: general,
            })
            const all = yield* registry.all()
            const domInfo = yield* AppDomTool
            const dom = yield* domInfo.init()
            const appControl = tools.find((tool) => tool.id === "app_control")
            const uiQuery = all.find((tool) => tool.id === "app_ui_query")
            const uiAction = all.find((tool) => tool.id === "app_ui_action")
            if (!appControl || !uiQuery || !uiAction) throw new Error("Expected aggregate and internal DOM/UI automation tools")
            expect(tools.some((tool) => tool.id === "app_dom")).toBe(false)
            expect(tools.some((tool) => tool.id === "app_ui_query")).toBe(false)
            expect(tools.some((tool) => tool.id === "app_ui_action")).toBe(false)

            expect(
              dom.parameters.safeParse({
                operation: "act",
                action: "setChecked",
                ref: "r1",
                checked: true,
              }).success,
            ).toBe(false)
            expect(
              dom.parameters.safeParse({
                operation: "act",
                action: "setChecked",
                window_id: 7,
                ref: "r1",
                checked: true,
              }).success,
            ).toBe(true)
            expect(
              dom.parameters.safeParse({
                operation: "act",
                action: "setExpanded",
                window_id: 7,
                ref: "r1",
              }).success,
            ).toBe(false)
            expect(
              uiAction.parameters.safeParse({ action: "click", token: "settings.app-control.copy-diagnostics" }).success,
            ).toBe(false)
            expect(
              uiAction.parameters.safeParse({
                action: "click",
                token: "settings.app-control.copy-diagnostics",
                window_id: 7,
              }).success,
            ).toBe(true)
            expect(uiAction.parameters.safeParse({ action: "click", token: "filetab.active.command-menu", window_id: 7 }).success).toBe(
              true,
            )
            expect(uiQuery.parameters.safeParse({ action: "catalog", window_id: 7 }).success).toBe(true)

            yield* appControl.execute(
              {
                operation: "dom",
                input: {
                  operation: "snapshot",
                  window_id: 7,
                  region: "#session",
                  selector: "button",
                  offset: 5,
                  limit: 20,
                },
              },
              baseCtx,
            )
            yield* appControl.execute(
              {
                operation: "dom",
                input: {
                  operation: "act",
                  action: "setChecked",
                  window_id: 7,
                  ref: "r1",
                  fingerprint: "fingerprint-1",
                  snapshot_id: "s1",
                  checked: true,
                },
              },
              baseCtx,
            )
            yield* appControl.execute({ operation: "ui_query", input: { action: "catalog", window_id: 7 } }, baseCtx)
            yield* appControl.execute(
              { operation: "ui_action", input: { action: "click", token: "settings.toggle", window_id: 7 } },
              baseCtx,
            )
          }),
        )

        expect(received.map((item) => item.url.pathname)).toEqual(["/dom/snapshot", "/dom/act", "/ui/catalog", "/ui/click"])
        expect(Object.fromEntries(received[0]?.url.searchParams ?? [])).toEqual({
          windowID: "7",
          selector: "button",
          region: "#session",
          offset: "5",
          limit: "20",
        })
        expect(received[1]?.body).toEqual({
          windowID: 7,
          action: "setChecked",
          ref: "r1",
          fingerprint: "fingerprint-1",
          snapshotID: "s1",
          checked: true,
        })
        expect(Object.fromEntries(received[2]?.url.searchParams ?? [])).toEqual({ windowID: "7" })
        expect(received[3]?.body).toEqual({ token: "settings.toggle", windowID: 7 })
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
    body?: unknown
  }) => Record<string, unknown>,
) {
  const received: Array<{
    method: string
    url: URL
    body?: unknown
  }> = []
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    received.push({
      method: request.method ?? "GET",
      url,
      body,
    })
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    response.end(JSON.stringify(respond({ method: request.method ?? "GET", url, body })))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Automation stub did not expose a TCP port")
  return {
    port: address.port,
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
