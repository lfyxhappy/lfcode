import { describe, expect, test } from "bun:test"
import { resolveConnectionGateResult } from "./connection-gate"

describe("connection gate loading logic", () => {
  test("uses current result during initial blocking check", () => {
    expect(
      resolveConnectionGateResult({
        blocking: true,
        current: true,
        latest: false,
      }),
    ).toBe(true)
  })

  test("uses latest settled result during background refetch", () => {
    expect(
      resolveConnectionGateResult({
        blocking: false,
        current: undefined,
        latest: true,
      }),
    ).toBe(true)
  })

  test("preserves last settled failure during background refetch", () => {
    expect(
      resolveConnectionGateResult({
        blocking: false,
        current: undefined,
        latest: false,
      }),
    ).toBe(false)
  })
})
