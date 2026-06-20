import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"
import { isSessionWorking } from "./session-status"

describe("isSessionWorking", () => {
  test("does not treat missing or idle status as working", () => {
    expect(isSessionWorking(undefined)).toBe(false)
    expect(isSessionWorking({ type: "idle" })).toBe(false)
  })

  test("treats active statuses as working", () => {
    expect(isSessionWorking({ type: "busy" })).toBe(true)
    expect(
      isSessionWorking({
        type: "retry",
        attempt: 1,
        message: "retrying",
        next: Date.now(),
      } satisfies SessionStatus),
    ).toBe(true)
  })
})
