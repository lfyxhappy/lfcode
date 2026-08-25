import { Hono, type Context } from "hono"
import z from "zod"
import { authorizeLanDevice, lanDeviceCookie } from "../mobile/routes"
import { MOBILE_PROTOCOL_VERSION, pairDevice, type MobileAccessState } from "../mobile/access"

const BrowserPairRequest = z.object({
  pairingKey: z.string().min(1).max(200),
  deviceID: z.string().min(1).max(200),
  deviceName: z.string().min(1).max(200),
})

export type LanAccessRoutesInput = {
  access: MobileAccessState
  hostName: string
  version: string
  capabilities: string[]
  service?: (request: Request) => Promise<Response>
}

export function LanAccessRoutes(input: LanAccessRoutesInput) {
  return new Hono()
    .get("/health", (c) => health(c, input))
    .get("/lan/v1/health", (c) => health(c, input))
    .post("/lan/v1/browser-pair", (c) => pairBrowser(c, input))
    .get("/lan", legacyRedirect)
    .get("/lan/", legacyRedirect)
    // Chromium requests manifests without the page's HttpOnly device cookie.
    // This file is static, contains no user data, and must remain fetchable so
    // the paired full Web UI does not surface a browser-level 401 error.
    .get("/site.webmanifest", (c) => forwardFullWebUI(c, input))
    .get("/", async (c, next) => {
      if (!c.req.query("pair")) return next()
      return pairingPage(c)
    })
    .use("*", async (c, next) => {
      const device = authorizeLanDevice(input.access, {
        authorization: c.req.header("authorization"),
        cookie: c.req.header("cookie"),
      })
      if (!device) return pairingRequired(c)
      c.header("Cache-Control", "no-store")
      return next()
    })
    .all("*", (c) => forwardFullWebUI(c, input))
}

function health(c: Context, input: LanAccessRoutesInput) {
  return c.json({ protocolVersion: MOBILE_PROTOCOL_VERSION, hostID: input.access.hostID, status: "ok" })
}

async function pairBrowser(c: Context, input: LanAccessRoutesInput) {
  const parsed = BrowserPairRequest.safeParse(await c.req.json().catch(() => undefined))
  if (!parsed.success) return c.json({ error: { code: "invalid_request", message: "Invalid browser pairing request", retryable: false } }, 400)
  c.header("Cache-Control", "no-store")
  const paired = pairDevice({
    state: input.access,
    pairingKey: parsed.data.pairingKey,
    deviceID: parsed.data.deviceID,
    deviceName: parsed.data.deviceName,
    source: c.req.header("x-lfcode-mobile-source")?.trim() || "unknown",
  })
  if (!paired.ok) {
    const status = paired.code === "rate_limited" ? 429 : 401
    return c.json({ error: { code: paired.code, message: "Browser pairing link was rejected", retryable: paired.code !== "rate_limited" } }, status)
  }
  c.header("Set-Cookie", lanDeviceCookie(paired.token))
  return c.json({ device: paired.device, hostID: input.access.hostID })
}

function legacyRedirect(c: Context) {
  const url = new URL(c.req.url)
  url.pathname = "/"
  return c.redirect(url.toString(), 308)
}

function pairingPage(c: Context) {
  c.header("Cache-Control", "no-store")
  c.header("Referrer-Policy", "no-referrer")
  const destination = pairingDestination(c.req.query("return"))
  return c.html(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lfcode</title>
<body><p id="status">正在建立安全连接...</p><script>
const url = new URL(location.href)
const pairingKey = url.searchParams.get("pair")
url.searchParams.delete("pair")
url.searchParams.delete("return")
history.replaceState(null, "", url.pathname + url.search + url.hash)
const storageKey = "lfcode.lan.device.id"
const deviceID = localStorage.getItem(storageKey) || crypto.randomUUID()
localStorage.setItem(storageKey, deviceID)
fetch("/lan/v1/browser-pair", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ pairingKey, deviceID, deviceName: "Browser " + navigator.platform.slice(0, 80) }) })
  .then((response) => response.ok ? location.replace(${JSON.stringify(destination)}) : response.json().then((value) => Promise.reject(new Error(value?.error?.message || "配对失败"))))
  .catch((error) => { document.getElementById("status").textContent = "连接失败：" + error.message })
</script></body></html>`)
}

function pairingDestination(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/"
  return value
}

function pairingRequired(c: Context) {
  c.header("Cache-Control", "no-store")
  c.header("Referrer-Policy", "no-referrer")
  c.header("X-Lfcode-Lan-Authorization", "pairing-required")
  if (!c.req.header("accept")?.includes("text/html")) {
    return c.json(
      { error: { code: "lan_pairing_required", message: "This browser must be paired again", retryable: false } },
      401,
    )
  }
  return c.html("<!doctype html><title>Lfcode</title><p>请使用新的局域网配对链接访问 Lfcode。</p>", 401)
}

function forwardFullWebUI(c: Context, input: LanAccessRoutesInput) {
  if (!input.service) return c.json({ error: { code: "service_unavailable", message: "LAN session service is unavailable", retryable: true } }, 503)
  return input.service(c.req.raw)
}
