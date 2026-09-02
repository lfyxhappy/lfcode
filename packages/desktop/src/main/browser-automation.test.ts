import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  getDesktopBrowserAutomationBridge,
  registerDesktopBrowserAutomationBridge,
  type DesktopBrowserAutomationBridge,
} from "@lfcode-ai/shared/desktop-browser-automation"

mock.module("electron", () => ({
  app: { getPath: () => "" },
  BrowserWindow: {
    fromId: () => undefined,
    getAllWindows: () => automationWindow ? [automationWindow] : [],
    getFocusedWindow: () => automationWindow,
  },
  session: { fromPartition: () => ({}) },
  webContents: { fromId: () => undefined },
}))

let browserTarget:
  | {
      sourceWindowID: number
      tabID: string
      guest: {
        getURL: () => string
        getTitle: () => string
        isDestroyed: () => boolean
        loadURL: (url: string) => Promise<void>
        executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      }
      sessionKey: string
      sessionID?: string
    }
  | undefined
let browserTargets: typeof browserTarget[] = []
let automationWindow:
  | {
      isDestroyed: () => boolean
      webContents: { getURL: () => string; send: (channel: string, detail: unknown) => void }
    }
  | undefined

mock.module("./browser-runtime", () => ({
  getBrowserTargetForSession: (_sessionKey: string, tabID?: string) => tabID ? browserTargets.find((item) => item?.tabID === tabID) : browserTarget,
  getReadyBrowserTargetForSession: (_sessionKey: string, tabID?: string) => tabID ? browserTargets.find((item) => item?.tabID === tabID) : browserTarget,
  hasBrowserTargetForSession: (_sessionKey: string, tabID?: string) => tabID ? browserTargets.some((item) => item?.tabID === tabID) : browserTarget !== undefined,
  refreshBrowserGuestPerformance: () => undefined,
  findBrowserCachedResourceByUrl: () => undefined,
  listBrowserConsoleForSession: () => [],
  listBrowserCachedResources: () => ({ cacheSizeBytes: 0, indexedEntryCount: 0, entries: [] }),
  listBrowserNetworkForSession: () => [],
}))

const { registerBrowserAutomationBridge } = await import("./browser-automation")

let previous: DesktopBrowserAutomationBridge | undefined

afterEach(() => {
  restoreBrowserAutomationBridge(previous)
  previous = undefined
  browserTarget = undefined
  browserTargets = []
  automationWindow = undefined
})

describe("browser automation non-preemptive controls", () => {
  test("selects an explicitly requested tab without falling back to the active tab", async () => {
    previous = getDesktopBrowserAutomationBridge()
    const active = {
      sourceWindowID: 1,
      tabID: "tab-active",
      sessionKey: "workspace/ses_123",
      guest: { getURL: () => "https://active.example/", getTitle: () => "Active", isDestroyed: () => false, loadURL: async () => {} },
    }
    const requested = {
      sourceWindowID: 1,
      tabID: "tab-requested",
      sessionKey: "workspace/ses_123",
      guest: { getURL: () => "https://requested.example/", getTitle: () => "Requested", isDestroyed: () => false, loadURL: async () => {} },
    }
    browserTarget = active
    browserTargets = [active, requested]
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    expect(bridge.getTarget({ sessionKey: "workspace/ses_123", tabID: "tab-requested" })).toMatchObject({
      tabID: "tab-requested",
      url: "https://requested.example/",
    })
    expect(() => bridge.getTarget({ sessionKey: "workspace/ses_123", tabID: "missing" })).toThrow("requested side browser tab")
    await expect(bridge.back({ sessionKey: "workspace/ses_123", tabID: "missing" })).rejects.toMatchObject({
      code: "browser_tab_not_found",
    })
  })

  test("creates a distinct session tab when newTab is requested", async () => {
    previous = getDesktopBrowserAutomationBridge()
    const active = {
      sourceWindowID: 1,
      tabID: "tab-active",
      sessionKey: "workspace/ses_123",
      guest: { getURL: () => "https://active.example/", getTitle: () => "Active", isDestroyed: () => false, loadURL: async () => {} },
    }
    let createdURL = "about:blank"
    const created = {
      sourceWindowID: 1,
      tabID: "",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => createdURL,
        getTitle: () => "",
        isDestroyed: () => false,
        loadURL: async (url: string) => {
          createdURL = url
        },
      },
    }
    browserTarget = active
    browserTargets = [active]
    automationWindow = {
      isDestroyed: () => false,
      webContents: {
        getURL: () => "http://app/#/workspace/session/ses_123",
        send: (_channel, detail) => {
          const value = detail as { tabID?: string }
          if (!value.tabID) throw new Error("new tab request must include tabID")
          created.tabID = value.tabID
          browserTargets = [active, created]
        },
      },
    }
    browserTargets = [browserTarget]
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    const target = await bridge.navigate({ sessionKey: "workspace/ses_123", url: "https://second.example/", newTab: true })
    expect(target.tabID).toMatch(/^b_/)
    expect(target.tabID).not.toBe(active.tabID)
    expect(createdURL).toBe("https://second.example/")
  })

  test("rejects hover, focus, and key injection without requiring a browser target", async () => {
    previous = getDesktopBrowserAutomationBridge()
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.hover({ sessionKey: "workspace/ses_123" })).rejects.toMatchObject({
      status: 409,
      code: "browser_input_injection_disabled",
    })
    await expect(bridge.focus({ sessionKey: "workspace/ses_123" })).rejects.toMatchObject({
      status: 409,
      code: "browser_input_injection_disabled",
    })
    await expect(bridge.pressKey({ sessionKey: "workspace/ses_123", key: "Enter" })).rejects.toMatchObject({
      status: 409,
      code: "browser_input_injection_disabled",
    })
  })

  test("clicks a selector when no snapshot ref is available", async () => {
    previous = getDesktopBrowserAutomationBridge()
    let script = ""
    browserTarget = {
      sourceWindowID: 1,
      tabID: "tab-1",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => "https://example.com/",
        getTitle: () => "Example",
        isDestroyed: () => false,
        loadURL: async () => {},
        executeJavaScript: async (value) => {
          script = value
          return { ok: true }
        },
      },
    }
    browserTargets = [browserTarget]
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.click({ sessionKey: "workspace/ses_123", selector: "[data-action=save]" })).resolves.toMatchObject({
      tabID: "tab-1",
    })
    expect(script).toContain('document.querySelector("[data-action=save]")')
  })

  test("retries a transient renderer lifecycle failure for read-only snapshots", async () => {
    previous = getDesktopBrowserAutomationBridge()
    let attempts = 0
    browserTarget = {
      sourceWindowID: 1,
      tabID: "tab-1",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => "https://example.com/",
        getTitle: () => "Example",
        isDestroyed: () => false,
        loadURL: async () => {},
        executeJavaScript: async () => {
          attempts += 1
          if (attempts === 1) throw new Error("Render frame was disposed before web contents can be used")
          return []
        },
      },
    }
    browserTargets = [browserTarget]
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.snapshot({ sessionKey: "workspace/ses_123", tabID: "tab-1" })).resolves.toMatchObject({
      target: { tabID: "tab-1", url: "https://example.com/" },
      elements: [],
    })
    expect(attempts).toBe(2)
  })

  test("retries a transient first navigation failure", async () => {
    previous = getDesktopBrowserAutomationBridge()
    let attempts = 0
    let currentURL = "about:blank"
    browserTarget = {
      sourceWindowID: 1,
      tabID: "tab-1",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => currentURL,
        getTitle: () => "",
        isDestroyed: () => false,
        loadURL: async (url) => {
          attempts += 1
          if (attempts === 1) throw new Error("target is still attaching")
          currentURL = url
        },
      },
    }
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.navigate({ sessionKey: "workspace/ses_123", url: "https://example.com/" })).resolves.toMatchObject({
      url: "https://example.com/",
      tabID: "tab-1",
    })
    expect(attempts).toBe(2)
  })

  test("returns browser_navigation_failed after navigation retries are exhausted", async () => {
    previous = getDesktopBrowserAutomationBridge()
    let attempts = 0
    browserTarget = {
      sourceWindowID: 1,
      tabID: "tab-1",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => "about:blank",
        getTitle: () => "",
        isDestroyed: () => false,
        loadURL: async () => {
          attempts += 1
          throw new Error("navigation failed")
        },
      },
    }
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.navigate({ sessionKey: "workspace/ses_123", url: "https://example.com/" })).rejects.toMatchObject({
      status: 502,
      code: "browser_navigation_failed",
    })
    expect(attempts).toBe(4)
  })

  test("stops retrying when the session target disappears", async () => {
    previous = getDesktopBrowserAutomationBridge()
    let attempts = 0
    browserTarget = {
      sourceWindowID: 1,
      tabID: "tab-1",
      sessionKey: "workspace/ses_123",
      guest: {
        getURL: () => "about:blank",
        getTitle: () => "",
        isDestroyed: () => false,
        loadURL: async () => {
          attempts += 1
          browserTarget = undefined
          throw new Error("target detached")
        },
      },
    }
    registerBrowserAutomationBridge()
    const bridge = getDesktopBrowserAutomationBridge()
    if (!bridge) throw new Error("Expected browser automation bridge")

    await expect(bridge.navigate({ sessionKey: "workspace/ses_123", url: "https://example.com/" })).rejects.toMatchObject({
      code: "browser_navigation_failed",
    })
    expect(attempts).toBe(1)
  })
})

function restoreBrowserAutomationBridge(previous: DesktopBrowserAutomationBridge | undefined) {
  if (previous) {
    registerDesktopBrowserAutomationBridge(previous)
    return
  }
  delete (globalThis as typeof globalThis & Record<symbol, unknown>)[Symbol.for("lfcode.desktop-browser-automation")]
}
