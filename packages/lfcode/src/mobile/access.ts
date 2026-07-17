import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"

export const MOBILE_PROTOCOL_VERSION = 1
const PAIRING_TTL_MS = 2 * 60 * 1000
const PAIRING_FAILURE_WINDOW_MS = 60 * 1000
const MAX_PAIRING_FAILURES = 5

export type MobileDevice = {
  id: string
  name: string
  tokenHash: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

type Pairing = {
  keyHash: string
  expiresAt: number
}

type FailedPairingAttempt = {
  count: number
  startedAt: number
}

export type MobileAccessState = {
  hostID: string
  devices: MobileDevice[]
  pairing?: Pairing
  failedPairingAttempts: Record<string, FailedPairingAttempt>
}

export type MobilePairing = {
  key: string
  expiresAt: number
}

export type MobilePairResult =
  | { ok: true; device: Omit<MobileDevice, "tokenHash">; token: string }
  | { ok: false; code: "invalid_pairing" | "pairing_expired" | "rate_limited" }

export function createMobileAccessState(hostID = `host_${randomUUID()}`): MobileAccessState {
  return {
    hostID,
    devices: [],
    failedPairingAttempts: {},
  }
}

export function createPairing(state: MobileAccessState, now = Date.now()): MobilePairing {
  const key = randomToken()
  const expiresAt = now + PAIRING_TTL_MS
  state.pairing = { keyHash: hash(key), expiresAt }
  state.failedPairingAttempts = {}
  return { key, expiresAt }
}

export function pairDevice(input: {
  state: MobileAccessState
  pairingKey: string
  deviceID: string
  deviceName: string
  source: string
  now?: number
}): MobilePairResult {
  const now = input.now ?? Date.now()
  const pairing = input.state.pairing
  if (isRateLimited(input.state, input.source, now)) return { ok: false, code: "rate_limited" }
  if (!pairing) return failedPairing(input.state, input.source, now, "invalid_pairing")
  if (pairing.expiresAt <= now) {
    input.state.pairing = undefined
    return failedPairing(input.state, input.source, now, "pairing_expired")
  }
  if (!matchesHash(pairing.keyHash, input.pairingKey)) return failedPairing(input.state, input.source, now, "invalid_pairing")

  input.state.pairing = undefined
  delete input.state.failedPairingAttempts[input.source]
  const token = randomToken()
  const device: MobileDevice = {
    id: input.deviceID,
    name: input.deviceName,
    tokenHash: hash(token),
    createdAt: now,
    lastSeenAt: now,
  }
  input.state.devices = [...input.state.devices.filter((item) => item.id !== input.deviceID), device]
  return { ok: true, device: publicDevice(device), token }
}

export function authorizeDevice(state: MobileAccessState, token: string, now = Date.now()) {
  const tokenHash = hash(token)
  const device = state.devices.find((item) => !item.revokedAt && matchesHash(item.tokenHash, token))
  if (!device) return
  device.lastSeenAt = now
  return publicDevice(device)
}

export function revokeDevice(state: MobileAccessState, deviceID: string, now = Date.now()) {
  const device = state.devices.find((item) => item.id === deviceID)
  if (!device || device.revokedAt) return
  device.revokedAt = now
  return publicDevice(device)
}

export function listDevices(state: MobileAccessState) {
  return state.devices.map(publicDevice)
}

function failedPairing(state: MobileAccessState, source: string, now: number, code: "invalid_pairing" | "pairing_expired") {
  const prior = state.failedPairingAttempts[source]
  const next = !prior || prior.startedAt + PAIRING_FAILURE_WINDOW_MS <= now ? { count: 1, startedAt: now } : { ...prior, count: prior.count + 1 }
  state.failedPairingAttempts[source] = next
  return { ok: false as const, code: next.count >= MAX_PAIRING_FAILURES ? ("rate_limited" as const) : code }
}

function isRateLimited(state: MobileAccessState, source: string, now: number) {
  const attempt = state.failedPairingAttempts[source]
  if (!attempt) return false
  if (attempt.startedAt + PAIRING_FAILURE_WINDOW_MS <= now) {
    delete state.failedPairingAttempts[source]
    return false
  }
  return attempt.count >= MAX_PAIRING_FAILURES
}

function publicDevice(device: MobileDevice) {
  const { tokenHash: _, ...publicDevice } = device
  return publicDevice
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function matchesHash(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected, "hex")
  const actualBytes = Buffer.from(hash(actual), "hex")
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

function randomToken() {
  return randomBytes(32).toString("base64url")
}
