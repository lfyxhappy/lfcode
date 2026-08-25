import { describe, expect, test } from "bun:test"
import { buildModel, modelPatchValue, zonedDateTimeToTimestamp } from "@/automation/scheduled-task-form"

describe("scheduled automation dialog helpers", () => {
  test("converts a wall-clock value using its selected timezone", () => {
    expect(zonedDateTimeToTimestamp("2026-01-02T09:00", "UTC")).toBe(Date.UTC(2026, 0, 2, 9))
    expect(zonedDateTimeToTimestamp("2026-01-02T09:00", "Asia/Shanghai")).toBe(Date.UTC(2026, 0, 2, 1))
    expect(zonedDateTimeToTimestamp("2026-01-02T09:00", "America/New_York")).toBe(Date.UTC(2026, 0, 2, 14))
  })

  test("clears an existing model snapshot when both model fields are blank", () => {
    expect(modelPatchValue(buildModel("", ""))).toBeNull()
    expect(modelPatchValue(buildModel("openai", "gpt-5.6"))).toEqual({ providerID: "openai", modelID: "gpt-5.6" })
  })
})
