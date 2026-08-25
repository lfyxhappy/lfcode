import { describe, expect, test } from "bun:test"
import {
  appControlDirty,
  appControlDiagnosticsFilename,
  appControlEventScopeOptions,
  appControlMessages,
  appControlSaveDisabled,
  createAppControlDraft,
  filterAppControlEvents,
  normalizeAppControlEvents,
  normalizeAppControlTargets,
  summarizeAppControlRequestLogs,
  type AppControlState,
} from "./settings-app-control-helpers"

const state = (): AppControlState => ({
  enabled: true,
  permission: "session_control",
  browser: { enabled: true, permission: "interactive" },
  target: "app",
  availableTargets: ["app"],
  service: {
    discoveryFile: "C:/Users/demo/.lfcode/state/automation/desktop.json",
    detected: true,
    host: "127.0.0.1",
    port: 4317,
  },
})

describe("settings app control helpers", () => {
  test("creates editable draft without target metadata", () => {
    expect(createAppControlDraft(state())).toEqual({
      enabled: true,
      permission: "session_control",
      browser: { enabled: true, permission: "interactive" },
    })
  })

  test("detects permission and enabled changes", () => {
    const saved = createAppControlDraft(state())
    expect(appControlDirty(saved, saved)).toBe(false)
    expect(appControlDirty(saved, { ...saved, enabled: false })).toBe(true)
    expect(appControlDirty(saved, { ...saved, permission: "read_only" })).toBe(true)
    expect(appControlDirty(saved, { ...saved, browser: { ...saved.browser, enabled: false } })).toBe(true)
  })

  test("disables save while loading, saving, or unchanged", () => {
    const saved = createAppControlDraft(state())
    expect(
      appControlSaveDisabled({
        saved,
        draft: saved,
        loading: false,
        saving: false,
      }),
    ).toBe(true)
    expect(
      appControlSaveDisabled({
        saved,
        draft: { ...saved, enabled: false },
        loading: true,
        saving: false,
      }),
    ).toBe(true)
    expect(
      appControlSaveDisabled({
        saved,
        draft: { ...saved, enabled: false },
        loading: false,
        saving: true,
      }),
    ).toBe(true)
    expect(
      appControlSaveDisabled({
        saved,
        draft: { ...saved, enabled: false },
        loading: false,
        saving: false,
        loadError: "load failed",
      }),
    ).toBe(true)
    expect(
      appControlSaveDisabled({
        saved,
        draft: { ...saved, enabled: false },
        loading: false,
        saving: false,
      }),
    ).toBe(false)
  })

  test("keeps load and save failures visible", () => {
    expect(appControlMessages()).toEqual([])
    expect(appControlMessages("load failed")).toEqual(["load failed"])
    expect(appControlMessages(undefined, "save failed")).toEqual(["save failed"])
    expect(appControlMessages("load failed", "save failed")).toEqual(["load failed", "save failed"])
  })

  test("normalizes generic target state with app fallback", () => {
    expect(normalizeAppControlTargets(undefined)).toEqual({
      targets: ["app"],
      selected: "app",
    })
    expect(
      normalizeAppControlTargets({
        ...state(),
        target: "app",
        availableTargets: ["app", "app"],
      }),
    ).toEqual({
      targets: ["app"],
      selected: "app",
    })
  })

  test("keeps only valid structured automation events", () => {
    const events = normalizeAppControlEvents([
        { id: 1, scope: "renderer", type: "browser.opened", timestamp: 123, data: { url: "https://example.com" } },
        { id: 2, scope: "server", type: "request", timestamp: 124, data: { requestID: "req-1", method: "GET", path: "/state" } },
        { id: 3, scope: "server", type: "response", timestamp: 124, data: { requestID: "req-1", status: 200, durationMs: 18 } },
        { id: 4, scope: "server", type: "response.error", timestamp: 125, data: { requestID: "req-2", status: 500, durationMs: 42 } },
        { bad: true },
      ])
    expect(events).toEqual([
      { id: 1, scope: "renderer", type: "browser.opened", timestamp: 123, data: { url: "https://example.com" } },
      { id: 2, scope: "server", type: "request", timestamp: 124, data: { requestID: "req-1", method: "GET", path: "/state" } },
      { id: 3, scope: "server", type: "response", timestamp: 124, data: { requestID: "req-1", status: 200, durationMs: 18 } },
      { id: 4, scope: "server", type: "response.error", timestamp: 125, data: { requestID: "req-2", status: 500, durationMs: 42 } },
    ])
    expect(appControlEventScopeOptions(events)).toEqual(["all", "renderer", "server"])
    expect(
      filterAppControlEvents(events, {
        scope: "server",
        kind: "all",
      }).map((item) => item.id),
    ).toEqual([2, 3, 4])
    expect(
      filterAppControlEvents(events, {
        scope: "all",
        kind: "requests",
      }).map((item) => item.id),
    ).toEqual([2, 3, 4])
    expect(
      filterAppControlEvents(events, {
        scope: "all",
        kind: "errors",
      }).map((item) => item.id),
    ).toEqual([4])
    expect(summarizeAppControlRequestLogs(events)).toEqual([
      {
        requestID: "req-2",
        scope: "server",
        timestamp: 125,
        status: 500,
        durationMs: 42,
        failed: true,
      },
      {
        requestID: "req-1",
        scope: "server",
        timestamp: 124,
        method: "GET",
        path: "/state",
        status: 200,
        durationMs: 18,
        failed: false,
      },
    ])
  })

  test("accepts the desktop bridge timestamp fields during protocol migration", () => {
    expect(
      normalizeAppControlEvents([
        { id: 1, scope: "server", type: "request", at: 123 },
        { id: 2, scope: "renderer", type: "route.changed", isoTime: "2026-07-26T01:02:03.000Z" },
      ]),
    ).toEqual([
      { id: 1, scope: "server", type: "request", timestamp: 123 },
      { id: 2, scope: "renderer", type: "route.changed", timestamp: Date.parse("2026-07-26T01:02:03.000Z") },
    ])
  })

  test("builds a stable diagnostics filename", () => {
    expect(appControlDiagnosticsFilename(new Date("2026-07-04T08:09:10"))).toBe(
      "lfcode-app-control-diagnostics-20260704-080910.json",
    )
  })
})
