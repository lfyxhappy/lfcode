import { describe, expect, test } from "bun:test"
import { lanAccessPairingState } from "./settings-lan-access"

describe("LAN access pairing state", () => {
  test("keeps a pairing link active through its expiry boundary", () => {
    expect(lanAccessPairingState({ url: "https://192.168.1.4/pair", expiresAt: 101 }, 100)).toBe("active")
  })

  test("does not expose an expired pairing link as usable", () => {
    expect(lanAccessPairingState({ url: "https://192.168.1.4/pair", expiresAt: 100 }, 100)).toBe("expired")
  })

  test("has an explicit empty state before a link is created", () => {
    expect(lanAccessPairingState(undefined, 100)).toBe("empty")
  })
})
