import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"

export const MOBILE_PROTOCOL_VERSION = 1
const PAIRING_TTL_MS = 2 * 60 * 1000
const PAIRING_FAILURE_WINDOW_MS = 60 * 1000
const MAX_PAIRING_FAILURES = 5
const MAX_ACTIVE_DEVICES = 32
const MAX_REVOKED_DEVICES = 16

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

export type MobilePairingPayload = {
  protocolVersion: typeof MOBILE_PROTOCOL_VERSION
  hostID: string
  endpoints: string[]
  spkiSha256: string
  pairingKey: string
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

export function createPairing(state: MobileAccessState, now = Date.now(), ttlMs = PAIRING_TTL_MS): MobilePairing {
  const key = randomToken()
  const expiresAt = now + ttlMs
  state.pairing = { keyHash: hash(key), expiresAt }
  state.failedPairingAttempts = {}
  return { key, expiresAt }
}

export function createPairingPayload(input: {
  state: MobileAccessState
  endpoints: string[]
  spkiSha256: string
  now?: number
}): MobilePairingPayload {
  const pairing = createPairing(input.state, input.now)
  const endpoints = input.endpoints.filter((endpoint) => isSecureEndpoint(endpoint))
  if (endpoints.length === 0) throw new Error("Mobile pairing requires at least one HTTPS endpoint")
  if (Buffer.from(input.spkiSha256, "base64").length !== 32) throw new Error("Mobile pairing requires a SHA-256 SPKI pin")
  return {
    protocolVersion: MOBILE_PROTOCOL_VERSION,
    hostID: input.state.hostID,
    endpoints,
    spkiSha256: input.spkiSha256,
    pairingKey: pairing.key,
    expiresAt: pairing.expiresAt,
  }
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
  return createDevice(input.state, input.deviceID, input.deviceName, now)
}

function createDevice(state: MobileAccessState, deviceID: string, deviceName: string, now: number): MobilePairResult {
  const token = randomToken()
  const device: MobileDevice = {
    id: deviceID,
    name: deviceName,
    tokenHash: hash(token),
    createdAt: now,
    lastSeenAt: now,
  }
  const previous = state.devices.filter((item) => item.id !== deviceID)
  const revoked = previous.filter((item) => item.revokedAt).sort((left, right) => left.lastSeenAt - right.lastSeenAt)
  const active = previous.filter((item) => !item.revokedAt).sort((left, right) => left.lastSeenAt - right.lastSeenAt)
  state.devices = [...revoked.slice(-MAX_REVOKED_DEVICES), ...active.slice(-(MAX_ACTIVE_DEVICES - 1)), device]
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

function isSecureEndpoint(value: string) {
  try {
    const endpoint = new URL(value)
    return endpoint.protocol === "https:" && Boolean(endpoint.hostname) && !endpoint.username && !endpoint.password
  } catch {
    return false
  }
}
