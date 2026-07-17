import { describe, expect, test } from "bun:test"
import { MobileRoutes, authorizeDevice, createMobileAccessState, createPairing, pairDevice, revokeDevice } from "../../src/mobile"

describe("mobile access", () => {
  test("pairs a device once and authorizes only its bearer token", () => {
    const state = createMobileAccessState("host_test")
    const pairing = createPairing(state, 1_000)
    const paired = pairDevice({
      state,
      pairingKey: pairing.key,
      deviceID: "android-test",
      deviceName: "Android test",
      source: "127.0.0.1",
      now: 1_001,
    })
    expect(paired.ok).toBe(true)
    if (!paired.ok) return
    expect(authorizeDevice(state, paired.token, 1_002)).toMatchObject({ id: "android-test", name: "Android test" })
    expect(authorizeDevice(state, "not-a-device-token", 1_002)).toBeUndefined()
    expect(pairDevice({ state, pairingKey: pairing.key, deviceID: "second", deviceName: "Second", source: "127.0.0.1", now: 1_002 })).toEqual({
      ok: false,
      code: "invalid_pairing",
    })
  })

  test("expires pairing keys, limits failures, and revokes devices", () => {
    const state = createMobileAccessState("host_test")
    const pairing = createPairing(state, 1_000)
    expect(pairDevice({ state, pairingKey: pairing.key, deviceID: "late", deviceName: "Late", source: "10.0.0.1", now: 121_000 })).toEqual({
      ok: false,
      code: "pairing_expired",
    })

    const active = createPairing(state, 200_000)
    for (let index = 0; index < 4; index++) {
      expect(pairDevice({ state, pairingKey: "wrong", deviceID: "bad", deviceName: "Bad", source: "10.0.0.2", now: 200_001 + index })).toEqual({
        ok: false,
        code: "invalid_pairing",
      })
    }
    expect(pairDevice({ state, pairingKey: "wrong", deviceID: "bad", deviceName: "Bad", source: "10.0.0.2", now: 200_005 })).toEqual({
      ok: false,
      code: "rate_limited",
    })
    const paired = pairDevice({ state, pairingKey: active.key, deviceID: "android-test", deviceName: "Android test", source: "10.0.0.3", now: 200_006 })
    expect(paired.ok).toBe(true)
    if (!paired.ok) return
    expect(revokeDevice(state, "android-test", 200_007)).toMatchObject({ revokedAt: 200_007 })
    expect(authorizeDevice(state, paired.token, 200_008)).toBeUndefined()
  })

  test("exposes only health, pairing, and token-protected host metadata", async () => {
    const state = createMobileAccessState("host_test")
    const pairing = createPairing(state)
    const app = MobileRoutes({ access: state, hostName: "Lfcode", version: "1.1.3", capabilities: ["sessions"] })

    const health = await app.request("/health")
    expect(await health.json()).toMatchObject({ hostID: "host_test", status: "ok" })
    expect((await app.request("/host")).status).toBe(401)
    const response = await app.request("/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingKey: pairing.key, deviceID: "android-test", deviceName: "Android test" }),
    })
    const paired = await response.json() as { token: string }
    expect(response.status).toBe(200)
    const host = await app.request("/host", { headers: { authorization: `Bearer ${paired.token}` } })
    expect(host.status).toBe(200)
    expect(await host.json()).toMatchObject({ hostID: "host_test", hostName: "Lfcode", capabilities: ["sessions"] })
    expect((await app.request("/session")).status).toBe(404)
  })
})
