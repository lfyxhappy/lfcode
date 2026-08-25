export const AUTOMATION_PROTOCOL_VERSION = 2

export type AutomationDiscovery = {
  host: string
  pid: number
  port: number
  startedAt: number
  token: string
  userData: string
  version: string
  protocolVersion?: number
  instanceID?: string
}

export type AutomationProtocolMetadata = {
  protocolVersion: number
  instanceID: string
  pid: number
  startedAt: number
  version: string
  capability: string
  features: string[]
}

export function isLoopbackAutomationHost(value: string) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (host === "localhost" || host === "::1") return true
  if (host.startsWith("::ffff:")) return isLoopbackAutomationHost(host.slice("::ffff:".length))
  const octets = host.split(".")
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false
  if (octets.some((octet) => Number(octet) > 255)) return false
  return Number(octets[0]) === 127
}

export function isAutomationPort(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 65_535
}

export function parseAutomationDiscovery(value: unknown): AutomationDiscovery {
  if (!isRecord(value)) throw new Error("Invalid automation discovery")
  const protocolVersion = value.protocolVersion
  const instanceID = value.instanceID
  if (typeof value.host !== "string" || !isLoopbackAutomationHost(value.host)) {
    throw new Error("Invalid automation discovery host")
  }
  if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error("Invalid automation discovery pid")
  }
  if (!isAutomationPort(value.port)) throw new Error("Invalid automation discovery port")
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt <= 0) {
    throw new Error("Invalid automation discovery start time")
  }
  if (typeof value.token !== "string" || !value.token) throw new Error("Invalid automation discovery token")
  if (typeof value.userData !== "string" || !value.userData) throw new Error("Invalid automation discovery user data")
  if (typeof value.version !== "string" || !value.version) throw new Error("Invalid automation discovery version")
  if (
    protocolVersion !== undefined &&
    (typeof protocolVersion !== "number" || !Number.isSafeInteger(protocolVersion) || protocolVersion < 1)
  ) {
    throw new Error("Invalid automation discovery protocol version")
  }
  if (instanceID !== undefined && (typeof instanceID !== "string" || !instanceID)) {
    throw new Error("Invalid automation discovery instance ID")
  }
  return {
    host: value.host,
    pid: value.pid,
    port: value.port,
    startedAt: value.startedAt,
    token: value.token,
    userData: value.userData,
    version: value.version,
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    ...(instanceID === undefined ? {} : { instanceID }),
  }
}

export function parseAutomationProtocolMetadata(value: unknown): AutomationProtocolMetadata {
  if (!isRecord(value)) throw new Error("Invalid automation metadata")
  const protocolVersion = value.protocolVersion
  if (typeof protocolVersion !== "number" || !Number.isSafeInteger(protocolVersion) || protocolVersion < 1) {
    throw new Error("Invalid automation metadata protocol version")
  }
  if (typeof value.instanceID !== "string" || !value.instanceID) throw new Error("Invalid automation metadata instance ID")
  if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error("Invalid automation metadata pid")
  }
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt <= 0) {
    throw new Error("Invalid automation metadata start time")
  }
  if (typeof value.version !== "string" || !value.version) throw new Error("Invalid automation metadata version")
  if (typeof value.capability !== "string" || !value.capability) throw new Error("Invalid automation metadata capability")
  if (!Array.isArray(value.features) || value.features.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Invalid automation metadata features")
  }
  return {
    protocolVersion,
    instanceID: value.instanceID,
    pid: value.pid,
    startedAt: value.startedAt,
    version: value.version,
    capability: value.capability,
    features: value.features,
  }
}

export function automationRequestNeedsAuth(method: string, path: string) {
  return !(method === "GET" && path === "/health")
}

export function parseAutomationRequestPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error("Automation request path must be an absolute local path")
  }
  const url = new URL(value, "http://127.0.0.1")
  if (url.origin !== "http://127.0.0.1") throw new Error("Automation request path must be an absolute local path")
  return url
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
