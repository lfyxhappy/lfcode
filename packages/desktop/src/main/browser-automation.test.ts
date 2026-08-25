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
    getAllWindows: () => [],
    getFocusedWindow: () => undefined,
  },
  session: { fromPartition: () => ({}) },
  webContents: { fromId: () => undefined },
}))

const { registerBrowserAutomationBridge } = await import("./browser-automation")

let previous: DesktopBrowserAutomationBridge | undefined

afterEach(() => {
  restoreBrowserAutomationBridge(previous)
  previous = undefined
})

describe("browser automation non-preemptive controls", () => {
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
})

function restoreBrowserAutomationBridge(previous: DesktopBrowserAutomationBridge | undefined) {
  if (previous) {
    registerDesktopBrowserAutomationBridge(previous)
    return
  }
  delete (globalThis as typeof globalThis & Record<symbol, unknown>)[Symbol.for("lfcode.desktop-browser-automation")]
}
