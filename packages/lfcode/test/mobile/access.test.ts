import { describe, expect, test } from "bun:test"
import { MobileRoutes, authorizeDevice, createMobileAccessState, createPairing, createPairingPayload, pairDevice, revokeDevice } from "../../src/mobile"
import { LanAccessRoutes } from "../../src/lan-access"

async function pairLanBrowser(input: { app: ReturnType<typeof LanAccessRoutes>; state: ReturnType<typeof createMobileAccessState>; deviceID: string }) {
  const pairing = createPairing(input.state)
  return input.app.request("/lan/v1/browser-pair", {
    method: "POST",
    headers: { "content-type": "application/json", "x-lfcode-mobile-source": "192.168.1.8" },
    body: JSON.stringify({ pairingKey: pairing.key, deviceID: input.deviceID, deviceName: "Browser test" }),
  })
}

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

  test("builds QR pairing payloads with HTTPS endpoints only", () => {
    const state = createMobileAccessState("host_test")
    const payload = createPairingPayload({
      state,
      endpoints: ["http://desktop.local:4097", "https://desktop.local:4097", "https://user:secret@desktop.local:4097"],
      spkiSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      now: 1_000,
    })
    expect(payload).toMatchObject({ hostID: "host_test", endpoints: ["https://desktop.local:4097"], expiresAt: 121_000 })
  })

  test("exchanges a one-time LAN pairing key for an HttpOnly browser cookie", async () => {
    const state = createMobileAccessState("host_test")
    const app = LanAccessRoutes({ access: state, hostName: "Lfcode", version: "1.1.3", capabilities: ["sessions"] })
    const rejected = await app.request("/lan/v1/browser-pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lfcode-mobile-source": "192.168.1.8" },
      body: JSON.stringify({ pairingKey: "wrong", deviceID: "browser-test", deviceName: "Browser test" }),
    })
    expect(rejected.status).toBe(401)
    const pairing = createPairing(state)
    const response = await app.request("/lan/v1/browser-pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lfcode-mobile-source": "192.168.1.8" },
      body: JSON.stringify({ pairingKey: pairing.key, deviceID: "browser-test", deviceName: "Browser test" }),
    })
    expect(response.status).toBe(200)
    const cookie = response.headers.get("set-cookie")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("SameSite=Strict")
    expect(cookie).toContain("Path=/")
    expect((await app.request("/", { headers: { cookie: cookie ?? "" } })).status).toBe(503)
    expect(state.devices).toHaveLength(1)
    expect((await app.request("/mobile/v1/host")).status).toBe(401)

    const repeated = await app.request("/lan/v1/browser-pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lfcode-mobile-source": "192.168.1.8" },
      body: JSON.stringify({ pairingKey: pairing.key, deviceID: "browser-second", deviceName: "Browser test" }),
    })
    expect(repeated.status).toBe(401)
  })

  test("retains a bounded device set across one-time browser pairing links", () => {
    const state = createMobileAccessState("host_test")
    for (let index = 0; index < 40; index++) {
      const pairing = createPairing(state, 2_000 + index)
      expect(pairDevice({ state, pairingKey: pairing.key, deviceID: `browser-${index}`, deviceName: "Browser", source: `10.0.0.${index}`, now: 2_000 + index }).ok).toBe(true)
    }
    expect(state.devices).toHaveLength(32)
  })

  test("requires a pairing link before serving the full web UI", async () => {
    const state = createMobileAccessState("host_test")
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["sessions"],
      service: async () => Response.json([]),
    })
    const root = await app.request("/", { headers: { accept: "text/html" } })
    expect(root.status).toBe(401)
    expect(await root.text()).toContain("配对链接")
    const api = await app.request("/session")
    expect(api.status).toBe(401)
    expect(api.headers.get("X-Lfcode-Lan-Authorization")).toBe("pairing-required")
    expect(await api.json()).toMatchObject({ error: { code: "lan_pairing_required", retryable: false } })
    const page = await app.request("/lan")
    expect(page.status).toBe(308)
    expect(page.headers.get("location")).toMatch(/\/$/)
    const shell = await app.request("/?pair=pairing-key&return=/Qzpcd29yay9zZXNzaW9u")
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain('location.replace("/Qzpcd29yay9zZXNzaW9u")')
    const rejectedDestination = await app.request("/?pair=pairing-key&return=https://untrusted.example")
    expect(await rejectedDestination.text()).toContain('location.replace("/")')
  })

  test("serves the static web manifest without a device cookie", async () => {
    const state = createMobileAccessState("host_test")
    const forwarded: string[] = []
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["sessions"],
      service: async (request) => {
        forwarded.push(new URL(request.url).pathname)
        return new Response('{"name":"Lfcode"}', { headers: { "content-type": "application/manifest+json" } })
      },
    })

    const manifest = await app.request("/site.webmanifest")
    expect(manifest.status).toBe(200)
    expect(await manifest.json()).toEqual({ name: "Lfcode" })
    expect(forwarded).toEqual(["/site.webmanifest"])
    expect((await app.request("/assets/app.js")).status).toBe(401)
  })

  test("proxies the desktop Web UI, assets, events, and native permission routes after pairing", async () => {
    const routes: string[] = []
    const state = createMobileAccessState("host_test")
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["sessions"],
      service: async (request) => {
        const url = new URL(request.url)
        routes.push(`${request.method} ${url.pathname}${url.search}`)
        return new Response(url.pathname === "/" ? "<!doctype html><title>Lfcode</title>" : "ok", { headers: { "content-type": url.pathname === "/" ? "text/html" : "text/plain" } })
      },
    })
    const login = await pairLanBrowser({ app, state, deviceID: "browser-catalog" })
    const cookie = login.headers.get("set-cookie") ?? ""

    expect((await app.request("/", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/assets/app.js", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/global/event", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/permission/per_test/reply?directory=C%3A%2Fwork", { method: "POST", headers: { cookie }, body: JSON.stringify({ reply: "once" }) })).status).toBe(200)
    expect(routes).toEqual([
      "GET /",
      "GET /assets/app.js",
      "GET /global/event",
      "POST /permission/per_test/reply?directory=C%3A%2Fwork",
    ])
  })

  test("forwards every paired-browser project request to the desktop service", async () => {
    const state = createMobileAccessState("host_test")
    const forwarded: string[] = []
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["desktop"],
      service: async (request) => {
        forwarded.push(new URL(request.url).pathname)
        return Response.json({ ok: true })
      },
    })
    const login = await pairLanBrowser({ app, state, deviceID: "directory-boundary" })
    const cookie = login.headers.get("set-cookie") ?? ""

    expect((await app.request("/session?directory=C%3A%2Fprivate", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/session?directory=C%3A%2Fwork", { headers: { cookie } })).status).toBe(200)
    expect(forwarded).toEqual(["/session", "/session"])
  })

  test("forwards model and configuration writes after pairing", async () => {
    const state = createMobileAccessState("host_test")
    const forwarded: string[] = []
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["sessions"],
      service: async (request) => {
        forwarded.push(`${request.method} ${new URL(request.url).pathname}`)
        return Response.json({ ok: true })
      },
    })
    const login = await pairLanBrowser({ app, state, deviceID: "model-boundary" })
    const cookie = login.headers.get("set-cookie") ?? ""

    expect((await app.request("/provider", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/provider/auth", { headers: { cookie } })).status).toBe(200)
    expect((await app.request("/provider/models/suggest", { method: "POST", headers: { cookie } })).status).toBe(200)
    expect((await app.request("/provider/openai/oauth/authorize", { method: "POST", headers: { cookie } })).status).toBe(200)
    expect((await app.request("/config", { method: "PATCH", headers: { cookie } })).status).toBe(200)
    expect((await app.request("/global/config", { method: "PATCH", headers: { cookie } })).status).toBe(200)
    expect(forwarded).toEqual([
      "GET /provider",
      "GET /provider/auth",
      "POST /provider/models/suggest",
      "POST /provider/openai/oauth/authorize",
      "PATCH /config",
      "PATCH /global/config",
    ])
  })

  test("forwards desktop control routes after pairing", async () => {
    const state = createMobileAccessState("host_test")
    const forwarded: string[] = []
    const app = LanAccessRoutes({
      access: state,
      hostName: "Lfcode",
      version: "1.1.3",
      capabilities: ["sessions"],
      service: async (request) => {
        forwarded.push(new URL(request.url).pathname)
        return Response.json({ ok: true })
      },
    })
    const login = await pairLanBrowser({ app, state, deviceID: "browser-events" })
    const cookie = login.headers.get("set-cookie") ?? ""
    for (const path of [
      "/pty",
      "/bash-interactive",
      "/mcp",
      "/global/mcp",
      "/global/playwright",
      "/global/app-control",
      "/global/automation",
      "/plugin",
      "/skills",
      "/hooks",
      "/agent/manage",
      "/background-job",
      "/actor-dispatch",
      "/capability",
      "/tui",
      "/lsp",
      "/cpp",
      "/sync",
    ]) {
      expect((await app.request(path, { headers: { cookie } })).status).toBe(200)
    }
    expect(forwarded).toEqual([
      "/pty",
      "/bash-interactive",
      "/mcp",
      "/global/mcp",
      "/global/playwright",
      "/global/app-control",
      "/global/automation",
      "/plugin",
      "/skills",
      "/hooks",
      "/agent/manage",
      "/background-job",
      "/actor-dispatch",
      "/capability",
      "/tui",
      "/lsp",
      "/cpp",
      "/sync",
    ])
  })
})
