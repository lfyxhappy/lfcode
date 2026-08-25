import { describe, expect, test } from "bun:test"
import { AutomationTaskCreate } from "../../src/scheduled-task"
import { isRecurring, nextRunAt, scheduleExpression } from "../../src/scheduled-task/schedule"

describe("scheduled task schedules", () => {
  test("validates five-field cron expressions and IANA timezones", () => {
    const input = {
      schedule: { kind: "cron" as const, expression: "0 9 * * 1-5" },
      target: { kind: "global" as const },
      message: "Prepare the daily summary",
      timezone: "Asia/Shanghai",
    }

    expect(AutomationTaskCreate.safeParse(input).success).toBe(true)
    expect(AutomationTaskCreate.safeParse({ ...input, schedule: { kind: "cron", expression: "0 0 9 * * *" } }).success).toBe(false)
    expect(AutomationTaskCreate.safeParse({ ...input, timezone: "Mars/Olympus" }).success).toBe(false)
    expect(AutomationTaskCreate.safeParse({ ...input, target: { kind: "project", projectID: "global" } }).success).toBe(false)
  })

  test("keeps interval schedules anchored to their creation time", () => {
    const schedule = { kind: "interval" as const, everyMs: 60_000, anchorAt: 10_000 }

    expect(nextRunAt({ schedule, timezone: "UTC", after: 0 })).toBe(10_000)
    expect(nextRunAt({ schedule, timezone: "UTC", after: 10_000 })).toBe(70_000)
    expect(nextRunAt({ schedule, timezone: "UTC", after: 130_001 })).toBe(190_000)
  })

  test("calculates one-time and common recurring schedules in the selected timezone", () => {
    const after = Date.UTC(2026, 0, 2, 10, 14)

    expect(nextRunAt({ schedule: { kind: "once", at: after - 1 }, timezone: "UTC", after })).toBe(after - 1)
    expect(nextRunAt({ schedule: { kind: "hourly", minute: 15 }, timezone: "UTC", after })).toBe(Date.UTC(2026, 0, 2, 10, 15))
    expect(nextRunAt({ schedule: { kind: "daily", hour: 9, minute: 30 }, timezone: "UTC", after })).toBe(Date.UTC(2026, 0, 3, 9, 30))
    expect(nextRunAt({ schedule: { kind: "weekly", dayOfWeek: 0, hour: 9, minute: 30 }, timezone: "UTC", after })).toBe(
      Date.UTC(2026, 0, 4, 9, 30),
    )
    expect(nextRunAt({ schedule: { kind: "cron", expression: "0 9 * * 1-5" }, timezone: "UTC", after })).toBe(
      Date.UTC(2026, 0, 5, 9),
    )
  })

  test("uses Croner's DST behavior without changing the wall-clock schedule", () => {
    const after = Date.parse("2026-03-08T06:59:00.000Z")
    const next = nextRunAt({
      schedule: { kind: "cron", expression: "0 2 * * *" },
      timezone: "America/New_York",
      after,
    })

    expect(next).toBe(Date.parse("2026-03-08T07:00:00.000Z"))
  })

  test("renders preset expressions and marks recurring schedules", () => {
    expect(scheduleExpression({ kind: "hourly", minute: 5 })).toBe("5 * * * *")
    expect(scheduleExpression({ kind: "daily", hour: 8, minute: 5 })).toBe("5 8 * * *")
    expect(scheduleExpression({ kind: "weekly", dayOfWeek: 2, hour: 8, minute: 5 })).toBe("5 8 * * 2")
    expect(isRecurring({ kind: "once", at: 1 })).toBe(false)
    expect(isRecurring({ kind: "interval", everyMs: 60_000 })).toBe(true)
  })
})
