import { afterEach, describe, expect, mock, test } from "bun:test"
import { createAutomationEventBuffer } from "./automation-events"
import {
  getDesktopBrowserAutomationBridge,
  registerDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationTarget,
} from "@lfcode-ai/shared/desktop-browser-automation"

type FakeAutomationWindow = {
  id: number
  isDestroyed: () => boolean
  getTitle: () => string
  isFocused: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  getBounds: () => Electron.Rectangle
  webContents: {
    getURL: () => string
    executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>
  }
}

const automationWindows: FakeAutomationWindow[] = []
let focusedAutomationWindow: FakeAutomationWindow | undefined

mock.module("electron", () => ({
  app: { getPath: () => "" },
  clipboard: { readText: () => "", writeText: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  BrowserWindow: {
    fromId: (id: number) => automationWindows.find((window) => window.id === id),
    getAllWindows: () => automationWindows,
    getFocusedWindow: () => focusedAutomationWindow,
  },
  session: {},
  webContents: {},
}))

const { startAutomationServer } = await import("./automation-server")
const servers: Array<NonNullable<Awaited<ReturnType<typeof startAutomationServer>>>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  automationWindows.splice(0)
  focusedAutomationWindow = undefined
})

describe("desktop automation protocol", () => {
  test("serves authenticated metadata and cursor events without poll self-wake", async () => {
    const events = createAutomationEventBuffer()
    const server = await startAutomationServer({
      enabled: true,
      capability: "read_only",
      instanceID: "test-instance",
      logger: { error: () => undefined, log: () => undefined },
      startedAt: 123,
      token: "test-token",
      version: "1.2.3",
      events,
    })
    if (!server) throw new Error("Expected desktop automation server")
    servers.push(server)
    const base = `http://${server.host}:${server.port}`

    expect((await fetch(`${base}/meta`)).status).toBe(401)
    const meta = await responseData<{
      protocolVersion: number
      instanceID: string
      pid: number
      startedAt: number
      version: string
      capability: string
      features: string[]
    }>(await fetch(`${base}/meta`, { headers: authorization(server.token) }))
    expect(meta).toMatchObject({
      protocolVersion: 2,
      instanceID: "test-instance",
      pid: process.pid,
      startedAt: 123,
      version: "1.2.3",
      capability: "read_only",
    })
    expect(meta.features).toContain("diagnostics.events.cursor")
    expect(meta.features).toContain("diagnostics.events.long_poll")
    expect(meta.features).toContain("desktop.non_preemptive")
    expect(meta.features).toContain("dom.semantic_refs")
    expect(meta.features).toContain("dom.snapshot_revisions")
    expect(meta.features).toContain("dom.segmented_snapshots")
    expect(meta.features).toContain("dom.idempotent_actions")
    expect(meta.features).toContain("dom.explicit_write_window")
    expect(meta.features).toContain("ui.global_registry")
    expect(meta).not.toHaveProperty("token")
    expect(meta).not.toHaveProperty("userData")

    events.clear()
    const legacy = await responseData<unknown>(
      await fetch(`${base}/diagnostics/events`, { headers: authorization(server.token) }),
    )
    expect(Array.isArray(legacy)).toBe(true)

    events.clear()
    const after = events.next().latestID
    const immediate = await responseData<{
      events: unknown[]
      nextCursor: number
      oldestID: number
      latestID: number
      resetRequired: boolean
    }>(
      await fetch(`${base}/diagnostics/events/next?after=${after}&waitMs=0`, {
        headers: authorization(server.token),
      }),
    )
    expect(immediate).toMatchObject({ events: [], nextCursor: after, latestID: after, resetRequired: false })
    expect(events.next({ after }).events).toEqual([])

    const cursor = events.next().latestID
    const pending = fetch(`${base}/diagnostics/events/next?after=${cursor}&waitMs=1000`, {
      headers: authorization(server.token),
    }).then((response) =>
      responseData<{
        events: Array<{ id: number; type: string }>
        nextCursor: number
      }>(response),
    )
    await waitFor(() => events.pendingWaiterCount() === 1)
    const pushed = events.push({ scope: "renderer", type: "route.changed" })
    await expect(pending).resolves.toMatchObject({
      events: [expect.objectContaining({ id: pushed.id, type: "route.changed" })],
      nextCursor: pushed.id,
    })
    expect(events.next({ after: pushed.id }).events).toEqual([])

    const abort = new AbortController()
    const disconnected = fetch(`${base}/diagnostics/events/next?after=${pushed.id}&waitMs=1000`, {
      headers: authorization(server.token),
      signal: abort.signal,
    })
    await waitFor(() => events.pendingWaiterCount() === 1)
    abort.abort()
    await expect(disconnected).rejects.toThrow()
    await waitFor(() => events.pendingWaiterCount() === 0)
  })

  test("rejects input and focus injection routes before accessing a window or browser target", async () => {
    const server = await startAutomationServer({
      enabled: true,
      capability: "full_app_control",
      instanceID: "non-preemptive-test",
      logger: { error: () => undefined, log: () => undefined },
      token: "non-preemptive-token",
      version: "1.2.3",
      events: createAutomationEventBuffer(),
    })
    if (!server) throw new Error("Expected desktop automation server")
    servers.push(server)
    const base = `http://${server.host}:${server.port}`

    for (const path of [
      "/window/focus",
      "/window/type",
      "/window/click",
      "/dom/press",
      "/browser/hover",
      "/browser/focus",
      "/browser/press-key",
    ]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { ...authorization(server.token), "content-type": "application/json" },
        body: "{}",
      })
      expect(response.status).toBe(410)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "input_injection_disabled",
        retryable: false,
      })
    }
  })

  test("exposes the global UI registry through a read-only catalog route", async () => {
    const executed: string[] = []
    addAutomationWindow({
      id: 60,
      executeJavaScript: async (script) => {
        executed.push(script)
        return [
          { token: "session.composer", available: true, operations: ["query", "type"] },
          { token: "workspace.filetree", available: true, operations: ["query", "click"] },
        ]
      },
    })
    const server = await startAutomationServer({
      enabled: true,
      capability: "read_only",
      logger: { error: () => undefined, log: () => undefined },
      token: "ui-catalog-token",
      version: "1.2.3",
      events: createAutomationEventBuffer(),
    })
    if (!server) throw new Error("Expected desktop automation server")
    servers.push(server)

    const catalog = await responseData<{
      windowID: number
      window: { id: number }
      catalog: Array<{ token: string; available: boolean; operations: string[] }>
    }>(
      await fetch(`http://${server.host}:${server.port}/ui/catalog?windowID=60`, {
        headers: authorization(server.token),
      }),
    )
    expect(catalog).toMatchObject({
      windowID: 60,
      window: { id: 60 },
      catalog: [
        { token: "session.composer", available: true, operations: ["query", "type"] },
        { token: "workspace.filetree", available: true, operations: ["query", "click"] },
      ],
    })
    expect(executed).toHaveLength(1)
    expect(executed[0]).toContain('bridge.call("ui.catalog", null)')
  })

  test("requires an explicit window for semantic writes while preserving default-window reads", async () => {
    const executed: string[] = []
    addAutomationWindow({
      id: 41,
      executeJavaScript: async (script) => {
        executed.push(script)
        if (script.includes('const action = "snapshot"')) {
          return {
            snapshotID: "s1",
            revision: 4,
            root: { ref: "r1" },
            children: [],
            nodes: [{ ref: "r1" }],
          }
        }
        return { action: "click", node: { ref: "r1" }, revision: 5 }
      },
    })
    const server = await startAutomationServer({
      enabled: true,
      capability: "full_app_control",
      logger: { error: () => undefined, log: () => undefined },
      token: "dom-window-token",
      version: "1.2.3",
      events: createAutomationEventBuffer(),
    })
    if (!server) throw new Error("Expected desktop automation server")
    servers.push(server)
    const base = `http://${server.host}:${server.port}`

    const snapshot = await responseData<{
      snapshotID: string
      revision: number
      windowID: number
      window: { id: number }
    }>(await fetch(`${base}/dom/snapshot`, { headers: authorization(server.token) }))
    expect(snapshot).toMatchObject({ snapshotID: "s1", revision: 4, windowID: 41, window: { id: 41 } })

    const missingWindow = await fetch(`${base}/dom/act`, {
      method: "POST",
      headers: { ...authorization(server.token), "content-type": "application/json" },
      body: JSON.stringify({ action: "click", selector: "button" }),
    })
    expect(missingWindow.status).toBe(400)
    await expect(missingWindow.json()).resolves.toMatchObject({
      ok: false,
      code: "window_id_required",
      retryable: false,
    })
    expect(executed).toHaveLength(1)

    const missingUiWindow = await fetch(`${base}/ui/click`, {
      method: "POST",
      headers: { ...authorization(server.token), "content-type": "application/json" },
      body: JSON.stringify({ token: "settings.toggle" }),
    })
    expect(missingUiWindow.status).toBe(400)
    await expect(missingUiWindow.json()).resolves.toMatchObject({
      ok: false,
      code: "window_id_required",
      retryable: false,
    })
    expect(executed).toHaveLength(1)

    const missingTarget = await fetch(`${base}/dom/act`, {
      method: "POST",
      headers: { ...authorization(server.token), "content-type": "application/json" },
      body: JSON.stringify({ windowID: 999, action: "click", selector: "button" }),
    })
    expect(missingTarget.status).toBe(404)
    await expect(missingTarget.json()).resolves.toMatchObject({ ok: false, code: "window_not_found" })
    expect(executed).toHaveLength(1)

    const missingTargetState = await fetch(`${base}/dom/act`, {
      method: "POST",
      headers: { ...authorization(server.token), "content-type": "application/json" },
      body: JSON.stringify({ windowID: 41, action: "setChecked", selector: "#enabled" }),
    })
    expect(missingTargetState.status).toBe(400)
    await expect(missingTargetState.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_dom_action_target",
    })
    expect(executed).toHaveLength(1)
  })

  test("rejects stale snapshot refs and keeps legacy ref actions compatible", async () => {
    addAutomationWindow({
      id: 42,
      executeJavaScript: async (script) => {
        const input = JSON.parse(script.match(/const input = (.+)\n/)?.[1] ?? "{}") as { snapshotID?: string }
        if (input.snapshotID === "unknown") {
          throw new Error("LFCODE_DOM_SNAPSHOT_STALE: The DOM changed after this snapshot; take a fresh DOM snapshot.")
        }
        return { action: "click", node: { ref: "r1" }, revision: 5 }
      },
    })
    const server = await startAutomationServer({
      enabled: true,
      capability: "full_app_control",
      logger: { error: () => undefined, log: () => undefined },
      token: "dom-snapshot-token",
      version: "1.2.3",
      events: createAutomationEventBuffer(),
    })
    if (!server) throw new Error("Expected desktop automation server")
    servers.push(server)
    const base = `http://${server.host}:${server.port}`

    const stale = await fetch(`${base}/dom/act`, {
      method: "POST",
      headers: { ...authorization(server.token), "content-type": "application/json" },
      body: JSON.stringify({
        windowID: 42,
        action: "click",
        ref: "r1",
        fingerprint: "button:save:0",
        snapshotID: "unknown",
      }),
    })
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      ok: false,
      code: "stale_dom_snapshot",
      retryable: true,
    })

    const legacy = await responseData<{ action: string; windowID: number }>(
      await fetch(`${base}/dom/act`, {
        method: "POST",
        headers: { ...authorization(server.token), "content-type": "application/json" },
        body: JSON.stringify({
          windowID: 42,
          action: "click",
          ref: "r1",
          fingerprint: "button:save:0",
        }),
      }),
    )
    expect(legacy).toMatchObject({ action: "click", windowID: 42 })
  })

  test("opens a session-owned browser target through the browser bridge", async () => {
    const previous = getDesktopBrowserAutomationBridge()
    const received: Array<Parameters<DesktopBrowserAutomationBridge["navigate"]>[0]> = []
    registerDesktopBrowserAutomationBridge({
      getTarget: () => undefined,
      navigate: async (input) => {
        received.push(input)
        return {
          sourceWindowID: 7,
          tabID: "tab-1",
          url: input.url,
          title: input.title ?? "",
          sessionKey: input.sessionKey,
          sessionID: input.sessionID,
        } satisfies DesktopBrowserAutomationTarget
      },
    } as DesktopBrowserAutomationBridge)

    try {
      const server = await startAutomationServer({
        enabled: true,
        capability: "browser_control",
        instanceID: "browser-target-test",
        logger: { error: () => undefined, log: () => undefined },
        token: "browser-target-token",
        version: "1.2.3",
        events: createAutomationEventBuffer(),
      })
      if (!server) throw new Error("Expected desktop automation server")
      servers.push(server)

      const response = await responseData<DesktopBrowserAutomationTarget>(
        await fetch(`http://${server.host}:${server.port}/browser/open`, {
          method: "POST",
          headers: {
            ...authorization(server.token),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sessionKey: "workspace/ses_123",
            sessionID: "ses_123",
            url: "https://example.com/",
            title: "Example",
            presentation: "sidebar",
          }),
        }),
      )

      expect(response).toMatchObject({
        sessionKey: "workspace/ses_123",
        sessionID: "ses_123",
        tabID: "tab-1",
      })
      expect(received).toEqual([
        {
          sessionKey: "workspace/ses_123",
          sessionID: "ses_123",
          url: "https://example.com/",
          title: "Example",
          presentation: "sidebar",
        },
      ])
    } finally {
      restoreBrowserAutomationBridge(previous)
    }
  })
})

function authorization(token: string) {
  return { authorization: `Bearer ${token}` }
}

async function responseData<T>(response: Response) {
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { ok: boolean; data?: T }
  expect(payload.ok).toBe(true)
  return payload.data as T
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for automation event waiter")
}

function restoreBrowserAutomationBridge(previous: DesktopBrowserAutomationBridge | undefined) {
  if (previous) {
    registerDesktopBrowserAutomationBridge(previous)
    return
  }
  delete (globalThis as typeof globalThis & Record<symbol, unknown>)[Symbol.for("lfcode.desktop-browser-automation")]
}

function addAutomationWindow(input: {
  id: number
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>
}) {
  const window: FakeAutomationWindow = {
    id: input.id,
    isDestroyed: () => false,
    getTitle: () => "Lfcode",
    isFocused: () => focusedAutomationWindow?.id === input.id,
    isVisible: () => true,
    isMinimized: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    webContents: {
      getURL: () => "http://localhost/",
      executeJavaScript: input.executeJavaScript,
    },
  }
  automationWindows.push(window)
  focusedAutomationWindow = window
  return window
}
