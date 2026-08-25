import path from "path"
import fsNode from "fs/promises"
import {
  automationRequestNeedsAuth,
  isAutomationPort,
  isLoopbackAutomationHost,
  parseAutomationDiscovery,
  parseAutomationProtocolMetadata,
  parseAutomationRequestPath,
  type AutomationProtocolMetadata,
} from "@lfcode-ai/shared/automation-protocol"
import { Global } from "@/global"
import { Config } from "@/config"
import type { Info, GlobalAppControlPermission, GlobalBrowserControlPermission } from "@/config/config"

type ClientOptions = {
  host?: string
  port?: number
  token?: string
  timeoutMs?: number
}

type Method = "GET" | "POST"

type ResponseEnvelope<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
  code?: string
  requestID?: string
  retryable?: boolean
  recovery?: string
}

export class AppControlRequestError extends Error {
  constructor(
    message: string,
    readonly details: { status?: number; code?: string; requestID?: string; retryable?: boolean; recovery?: string },
  ) {
    super(message)
    this.name = "AppControlRequestError"
  }
}

export class AutomationClientConfigurationError extends Error {
  constructor(
    readonly code: "automation_endpoint_invalid" | "automation_instance_mismatch" | "automation_token_missing",
    message: string,
    readonly recovery: string,
  ) {
    super(`${message} [${code}] ${recovery}`)
    this.name = "AutomationClientConfigurationError"
  }
}

export class BrowserControlAccessError extends Error {
  constructor(
    readonly code: "browser_control_disabled" | "browser_permission_denied",
    message: string,
    readonly recovery: string,
  ) {
    super(`${message} [${code}] ${recovery}`)
    this.name = "BrowserControlAccessError"
  }
}

export class AutomationServiceUnavailableError extends Error {
  readonly code: "automation_service_unavailable"
  readonly recovery: string

  constructor(message: string) {
    const code = "automation_service_unavailable" as const
    const recovery = "Open the Lfcode desktop app, then retry the browser action."
    super(`${message} [${code}] ${recovery}`)
    this.name = "AutomationServiceUnavailableError"
    this.code = code
    this.recovery = recovery
  }
}

export function ensureAppControlAccess(
  config: Info,
  required: "read_only" | "session_control" | "browser_control" | "full_app_control",
) {
  const current = Config.resolveGlobalAppControlConfig(config)
  if (!current.enabled) {
    throw new Error("App Control is disabled in global settings.")
  }
  if (appControlPermissionRank(current.permission) < appControlPermissionRank(required)) {
    throw new Error(
      `App Control permission is '${current.permission}', but this action requires '${required}'.`,
    )
  }
  return current
}

export function ensureBrowserControlAccess(config: Info, required: GlobalBrowserControlPermission) {
  const current = Config.resolveGlobalBrowserControlConfig(config)
  if (!current.enabled) {
    throw new BrowserControlAccessError(
      "browser_control_disabled",
      "Built-in Browser Control is disabled.",
      "Enable it in Settings > App Control > Built-in browser control, then retry.",
    )
  }
  if (browserControlPermissionRank(current.permission) < browserControlPermissionRank(required)) {
    throw new BrowserControlAccessError(
      "browser_permission_denied",
      `Built-in Browser Control permission is '${current.permission}', but this action requires '${required}'.`,
      "In Settings > App Control > Built-in browser control, change the permission to Interactive, then retry.",
    )
  }
  return current
}

export async function createAppControlClient(options?: ClientOptions) {
  const configuredPort =
    parseConfiguredPort(options?.port, "option") ?? parseConfiguredPort(process.env.LFCODE_AUTOMATION_PORT, "environment")
  const discovered = configuredPort === undefined ? await readAutomationDiscovery() : undefined
  const host = options?.host ?? process.env.LFCODE_AUTOMATION_HOST ?? discovered?.host ?? "127.0.0.1"
  const port = configuredPort ?? discovered?.port
  const token = options?.token ?? process.env.LFCODE_AUTOMATION_TOKEN ?? discovered?.token ?? ""
  if (!port) {
    throw new AutomationServiceUnavailableError(
      `No running desktop automation service was discovered. Expected file: ${resolveAutomationStateFile()}`,
    )
  }
  if (!isAutomationPort(port) || !isLoopbackAutomationHost(host)) {
    throw new AutomationClientConfigurationError(
      "automation_endpoint_invalid",
      "The desktop automation endpoint must use a valid loopback host and port.",
      "Restart the Lfcode desktop app or remove the stale automation discovery file, then retry.",
    )
  }

  let readMetadata: () => Promise<AutomationProtocolMetadata>
  const request = async <T>(method: Method, route: string, body?: unknown, verifyDiscovery = true) => {
    if (
      verifyDiscovery &&
      discovered &&
      (discovered.instanceID !== undefined || discovered.protocolVersion !== undefined)
    ) {
      await readMetadata()
    }
    const path = parseRequestPath(route)
    const needsAuth = automationRequestNeedsAuth(method, path.pathname)
    if (needsAuth && !token) {
      throw new AutomationClientConfigurationError(
        "automation_token_missing",
        "The desktop automation token is missing.",
        "Restart the Lfcode desktop app so it can refresh local automation discovery, then retry.",
      )
    }
    const response = await fetch(new URL(`${path.pathname}${path.search}`, `http://${formatAutomationHost(host)}:${port}`), {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(needsAuth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 30_000),
    }).catch(() => {
      throw new AutomationServiceUnavailableError(`The desktop automation service could not be reached at http://${host}:${port}.`)
    })
    const payload = (await response.json().catch(() => undefined)) as ResponseEnvelope<T> | undefined
    if (!response.ok || !payload?.ok) {
      const details = {
        status: response.status,
        code: payload?.code,
        requestID: payload?.requestID,
        retryable: payload?.retryable,
        recovery: payload?.recovery,
      }
      throw new AppControlRequestError(
        [
          payload?.error ?? `App Control request failed: ${method} ${route}`,
          details.code ? `[${details.code}]` : undefined,
          details.requestID ? `(request ${details.requestID})` : undefined,
          details.recovery,
        ]
          .filter(Boolean)
          .join(" "),
        details,
      )
    }
    return payload.data as T
  }

  let metadata: Promise<AutomationProtocolMetadata> | undefined
  readMetadata = () => {
    metadata ??= request<unknown>("GET", "/meta", undefined, false).then((value) => {
      const result = parseAutomationProtocolMetadata(value)
      validateDiscoveryMetadata(discovered, result)
      return result
    })
    return metadata
  }

  return {
    host,
    port,
    getMetadata: readMetadata,
    get: <T>(route: string) => request<T>("GET", route),
    post: <T>(route: string, body?: unknown) => request<T>("POST", route, body),
  }
}

export function browserControlPermissionRank(permission: GlobalBrowserControlPermission) {
  return permission === "read_only" ? 0 : 1
}

export function appControlPermissionRank(permission: GlobalAppControlPermission) {
  if (permission === "read_only") return 0
  if (permission === "session_control") return 1
  if (permission === "browser_control") return 2
  return 3
}

export async function readAutomationDiscovery() {
  const text = await fsNode.readFile(resolveAutomationStateFile(), "utf8").catch(() => undefined)
  if (!text) return undefined
  try {
    return parseAutomationDiscovery(JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

export function resolveAutomationStateFile() {
  if (process.env.LFCODE_AUTOMATION_STATE_FILE) return process.env.LFCODE_AUTOMATION_STATE_FILE
  if (process.env.LFCODE_STATE_DIR) return path.join(process.env.LFCODE_STATE_DIR, "automation", "desktop.json")
  return path.join(Global.Path.home, ".lfcode", "state", "automation", "desktop.json")
}

function parseConfiguredPort(value: number | string | undefined, source: "option" | "environment") {
  if (value === undefined || value === "") return undefined
  const port = typeof value === "number" ? value : Number(value)
  if (isAutomationPort(port)) return port
  throw new AutomationClientConfigurationError(
    "automation_endpoint_invalid",
    `The desktop automation ${source} port is invalid.`,
    "Use a loopback desktop automation endpoint with a port from 1 through 65535.",
  )
}

function parseRequestPath(route: string) {
  try {
    return parseAutomationRequestPath(route)
  } catch {
    throw new AutomationClientConfigurationError(
      "automation_endpoint_invalid",
      "The desktop automation request path is invalid.",
      "Use an absolute local automation route beginning with '/'.",
    )
  }
}

function validateDiscoveryMetadata(discovery: Awaited<ReturnType<typeof readAutomationDiscovery>> | undefined, metadata: AutomationProtocolMetadata) {
  if (discovery?.instanceID !== undefined && discovery.instanceID !== metadata.instanceID) {
    throw new AutomationClientConfigurationError(
      "automation_instance_mismatch",
      "The desktop automation discovery record belongs to a different running app instance.",
      "Restart the Lfcode desktop app to refresh local automation discovery, then retry.",
    )
  }
  if (discovery?.protocolVersion !== undefined && discovery.protocolVersion !== metadata.protocolVersion) {
    throw new AutomationClientConfigurationError(
      "automation_instance_mismatch",
      "The desktop automation protocol version does not match its discovery record.",
      "Restart the Lfcode desktop app to refresh local automation discovery, then retry.",
    )
  }
}

function formatAutomationHost(host: string) {
  const value = host.replace(/^\[|\]$/g, "")
  return value.includes(":") ? `[${value}]` : value
}
