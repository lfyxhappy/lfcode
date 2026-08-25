import { Hono, type Context } from "hono"
import z from "zod"
import {
  MOBILE_PROTOCOL_VERSION,
  authorizeDevice,
  pairDevice,
  type MobileAccessState,
} from "./access"

const PairRequest = z.object({
  pairingKey: z.string().min(1),
  deviceID: z.string().min(1).max(200),
  deviceName: z.string().min(1).max(200),
})

const DEVICE_COOKIE = "lfcode_lan_device"

export function authorizeLanDevice(state: MobileAccessState, headers: { authorization?: string; cookie?: string }) {
  return authorizeDevice(state, deviceToken(headers.authorization, headers.cookie))
}

export function lanDeviceCookie(token: string) {
  return `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`
}

export function MobileRoutes(input: {
  access: MobileAccessState
  hostName: string
  version: string
  capabilities: string[]
}) {
  return new Hono()
    .get("/health", (c) =>
      c.json({
        protocolVersion: MOBILE_PROTOCOL_VERSION,
        hostID: input.access.hostID,
        status: "ok",
      }),
    )
    .post("/pair", async (c) => {
      const parsed = PairRequest.safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) return mobileError(c, 400, "invalid_request", "Invalid mobile pairing request", false)
      const paired = pairDevice({
        state: input.access,
        pairingKey: parsed.data.pairingKey,
        deviceID: parsed.data.deviceID,
        deviceName: parsed.data.deviceName,
        source: sourceAddress(c.req.header("x-lfcode-mobile-source")),
      })
      if (!paired.ok) {
        const status = paired.code === "rate_limited" ? 429 : 401
        return mobileError(c, status, paired.code, "Mobile pairing was rejected", paired.code !== "rate_limited")
      }
      return c.json({
        protocolVersion: MOBILE_PROTOCOL_VERSION,
        hostID: input.access.hostID,
        device: paired.device,
        token: paired.token,
      })
    })
    .get("/host", (c) => {
      const device = authorizeLanDevice(input.access, { authorization: c.req.header("authorization"), cookie: c.req.header("cookie") })
      if (!device) return mobileError(c, 401, "unauthorized", "A valid paired device token is required", true)
      return c.json({
        protocolVersion: MOBILE_PROTOCOL_VERSION,
        hostID: input.access.hostID,
        hostName: input.hostName,
        version: input.version,
        capabilities: input.capabilities,
        device,
        serverTime: Date.now(),
      })
    })
}

function bearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return ""
  return header.slice("Bearer ".length)
}

function deviceToken(authorization: string | undefined, cookie: string | undefined) {
  const bearer = bearerToken(authorization)
  if (bearer) return bearer
  return cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1) ?? ""
}

function sourceAddress(value: string | undefined) {
  return value?.trim() || "unknown"
}

function mobileError(c: Context, status: 400 | 401 | 429, code: string, message: string, retryable: boolean) {
  return c.json({ error: { code, message, retryable } }, status)
}
