import { describe, expect, test } from "bun:test"
import { shouldNotifyAutomationRun, shouldNotifySessionError } from "@/automation/notification-policy"

describe("automation run notifications", () => {
  test("does not treat a busy session as a question", () => {
    expect(shouldNotifyAutomationRun({ status: "waiting_for_session", notifications: "all" })).toBe(false)
    expect(shouldNotifyAutomationRun({ status: "queued", notifications: "all" })).toBe(false)
    expect(shouldNotifyAutomationRun({ status: "running", notifications: "all" })).toBe(false)
  })

  test("notifies for failures and manual input, including failures-only mode", () => {
    expect(shouldNotifyAutomationRun({ status: "failed", notifications: "all" })).toBe(true)
    expect(shouldNotifyAutomationRun({ status: "awaiting_user", notifications: "all" })).toBe(true)
    expect(shouldNotifyAutomationRun({ status: "awaiting_user", notifications: "failures" })).toBe(true)
    expect(shouldNotifyAutomationRun({ status: "completed", notifications: "all" })).toBe(false)
    expect(shouldNotifyAutomationRun({ status: "failed", notifications: "none" })).toBe(false)
  })

  test("does not notify for hidden system session errors", () => {
    expect(shouldNotifySessionError({ properties: { visible: false } })).toBe(false)
    expect(shouldNotifySessionError({ properties: { visible: true } })).toBe(true)
    expect(shouldNotifySessionError({ properties: {} })).toBe(true)
  })
})
