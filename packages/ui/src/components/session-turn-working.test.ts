import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"
import { isSessionTurnWorking } from "./session-turn-working"

describe("session turn working", () => {
  test("keeps the active turn working while session is still streaming", () => {
    expect(
      isSessionTurnWorking({
        status: { type: "busy" } satisfies SessionStatus,
        active: true,
        hasPendingAssistant: false,
      }),
    ).toBe(true)
  })

  test("treats retry as working for the active turn", () => {
    expect(
      isSessionTurnWorking({
        status: { type: "retry", attempt: 1, message: "retrying", next: Date.now() } satisfies SessionStatus,
        active: true,
        hasPendingAssistant: false,
      }),
    ).toBe(true)
  })

  test("does not treat waiting as working", () => {
    expect(
      isSessionTurnWorking({
        status: { type: "waiting", mode: "interactive-html" } satisfies SessionStatus,
        active: true,
        hasPendingAssistant: true,
      }),
    ).toBe(false)
  })

  test("falls back to pending assistant detection when explicit active state is absent", () => {
    expect(
      isSessionTurnWorking({
        status: { type: "busy" } satisfies SessionStatus,
        hasPendingAssistant: true,
      }),
    ).toBe(true)
  })

  test("does not mark inactive turns as working", () => {
    expect(
      isSessionTurnWorking({
        status: { type: "busy" } satisfies SessionStatus,
        active: false,
        hasPendingAssistant: true,
      }),
    ).toBe(false)
  })
})
