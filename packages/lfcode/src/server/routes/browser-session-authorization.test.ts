import { afterEach, describe, expect, test } from "bun:test"
import {
  allowBrowserNavigation,
  browserConfirmationRequired,
  browserSessionKey,
  clearBrowserNavigationAuthorization,
  resetBrowserNavigationAuthorizations,
} from "./browser-session-authorization"

describe("browser session authorization", () => {
  afterEach(() => resetBrowserNavigationAuthorizations())

  test("does not create a target without explicit confirmation", () => {
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: false })).toBe(false)
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: false })).toBe(false)
  })

  test("confirmation authorizes only the current session", () => {
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: false, confirm: true })).toBe(true)
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: false })).toBe(true)
    expect(allowBrowserNavigation({ sessionKey: "session-b", hasTarget: false })).toBe(false)
  })

  test("an existing target is treated as an explicit browser surface", () => {
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: true })).toBe(true)
    clearBrowserNavigationAuthorization("session-a")
    expect(allowBrowserNavigation({ sessionKey: "session-a", hasTarget: false })).toBe(false)
  })

  test("uses one normalized key and confirmation shape for every browser entry point", () => {
    const sessionKey = browserSessionKey({ directory: "C:\\work\\demo", sessionID: "ses_demo" })
    expect(sessionKey).toBe("Qzovd29yay9kZW1v/ses_demo")
    expect(
      browserConfirmationRequired({
        sessionKey,
        url: "https://example.com",
        reason: "Opening a side browser tab needs explicit user approval.",
      }),
    ).toEqual({
      type: "browser_confirmation_required",
      sessionKey,
      url: "https://example.com",
      reason: "Opening a side browser tab needs explicit user approval.",
      scope: "session-browser-read",
    })
  })
})
