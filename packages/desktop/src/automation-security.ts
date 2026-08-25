import { randomBytes, timingSafeEqual } from "node:crypto"
import type { IncomingHttpHeaders, IncomingMessage } from "node:http"
import { URL } from "node:url"

export const AUTOMATION_BODY_LIMIT_BYTES = 1024 * 1024
export const AUTOMATION_BODY_TIMEOUT_MS = 5_000

export type AutomationCapability = "read_only" | "session_control" | "browser_control" | "full_app_control"

export class AutomationHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options?: { retryable?: boolean; recovery?: string },
  ) {
    super(message)
    this.name = "AutomationHttpError"
  }
}

export function createAutomationToken() {
  return randomBytes(32).toString("base64url")
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

export function validateAutomationRequestSource(headers: IncomingHttpHeaders, expectedPort: number) {
  const host = requireSingleHeader(headers.host, "Host")
  if (/[@\\/,\s]/.test(host)) throw forbiddenSource("Host")
  const hostURL = parseURL(`http://${host}`, "Host")
  if (!isLoopbackAutomationHost(hostURL.hostname) || resolvedPort(hostURL) !== expectedPort) {
    throw forbiddenSource("Host")
  }

  const origin = optionalSingleHeader(headers.origin, "Origin")
  if (!origin) return
  const originURL = parseURL(origin, "Origin")
  if (
    originURL.protocol !== "http:" ||
    originURL.username ||
    originURL.password ||
    originURL.pathname !== "/" ||
    originURL.search ||
    originURL.hash ||
    !isLoopbackAutomationHost(originURL.hostname) ||
    resolvedPort(originURL) !== expectedPort
  ) {
    throw forbiddenSource("Origin")
  }
}

export function automationRequestNeedsAuth(method: string, path: string) {
  return !(method === "GET" && path === "/health")
}

export function isAutomationRequestAuthorized(headers: IncomingHttpHeaders, token: string) {
  const authorization = optionalSingleHeader(headers.authorization, "Authorization")
  const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
  const legacy = optionalSingleHeader(headers["x-lfcode-automation-token"], "X-Lfcode-Automation-Token")
  return secureEqual(bearer, token) || secureEqual(legacy, token)
}

export function requireAutomationCapability(
  granted: AutomationCapability,
  method: string,
  path: string,
) {
  const required = minimumAutomationCapability(method, path)
  if (capabilityRank(granted) >= capabilityRank(required)) return
  throw new AutomationHttpError(403, "insufficient_capability", "Forbidden")
}

export function minimumAutomationCapability(method: string, path: string): AutomationCapability {
  if (method === "GET" && isReadOnlyRoute(path)) return "read_only"
  if (method === "POST" && isReadOnlyPostRoute(path)) return "read_only"
  if (
    path.startsWith("/session/") ||
    path.startsWith("/sidechat/") ||
    path.startsWith("/composer/") ||
    path === "/timeline/scroll" ||
    path === "/wait"
  ) {
    return "session_control"
  }
  if (path.startsWith("/browser/")) return "browser_control"
  return "full_app_control"
}

export async function readAutomationRequestBody(
  request: IncomingMessage,
  options?: { limitBytes?: number; timeoutMs?: number },
) {
  const limitBytes = options?.limitBytes ?? AUTOMATION_BODY_LIMIT_BYTES
  const contentLength = parseContentLength(request.headers["content-length"])
  if (contentLength !== undefined && contentLength > limitBytes) {
    throw new AutomationHttpError(413, "body_too_large", "Request body is too large")
  }

  const chunks = await collectBody(request, limitBytes, options?.timeoutMs ?? AUTOMATION_BODY_TIMEOUT_MS)
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return undefined

  try {
    const body = JSON.parse(text) as unknown
    if (!isRecord(body)) {
      throw new AutomationHttpError(400, "invalid_json_body", "Request body must be a JSON object")
    }
    return body
  } catch (error) {
    if (error instanceof AutomationHttpError) throw error
    throw new AutomationHttpError(400, "invalid_json_body", "Request body contains invalid JSON")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function automationErrorResponse(error: unknown) {
  if (error instanceof AutomationHttpError) {
    return {
      status: error.status,
      error: error.message,
      logCode: error.code,
      code: error.code,
      retryable: error.options?.retryable ?? false,
      recovery: error.options?.recovery,
    }
  }
  return {
    status: 500,
    error: "Automation request failed",
    logCode: error instanceof Error ? error.name : "unknown_error",
    code: "automation_request_failed",
    retryable: false,
    recovery: "Open Settings > App Control diagnostics and use the request ID to inspect the failure.",
  }
}

export function browserAutomationError(
  code: "browser_target_missing" | "browser_target_not_ready" | "browser_bridge_unavailable" | "browser_renderer_unavailable",
) {
  const details = {
    browser_target_missing: {
      status: 404,
      message: "No active side browser tab exists for this session.",
      retryable: false,
      recovery: "Open or bind a side browser tab for this session, then retry.",
    },
    browser_target_not_ready: {
      status: 409,
      message: "The side browser tab is still starting.",
      retryable: true,
      recovery: "Wait briefly, then retry the browser request.",
    },
    browser_bridge_unavailable: {
      status: 503,
      message: "The desktop browser automation bridge is unavailable.",
      retryable: true,
      recovery: "Keep the desktop app open and retry after its browser surface has loaded.",
    },
    browser_renderer_unavailable: {
      status: 503,
      message: "The side browser renderer is unavailable.",
      retryable: true,
      recovery: "Wait for the tab to finish loading or reopen it, then retry.",
    },
  }[code]
  return new AutomationHttpError(details.status, code, details.message, {
    retryable: details.retryable,
    recovery: details.recovery,
  })
}

export function inputInjectionDisabled(route: string) {
  return new AutomationHttpError(
    410,
    "input_injection_disabled",
    `The ${route} route is disabled because desktop automation never injects mouse, keyboard, or focus input.`,
    {
      retryable: false,
      recovery: "Use a semantic UI ref action, an application command, or a non-preemptive window management route instead.",
    },
  )
}

function isReadOnlyRoute(path: string) {
  return (
    path === "/health" ||
    path === "/meta" ||
    path === "/windows" ||
    path.startsWith("/diagnostics/") ||
    path === "/timeline/state" ||
    path === "/clipboard" ||
    path === "/dom/snapshot" ||
    path === "/ui/catalog" ||
    path === "/browser/target" ||
    path === "/browser/cache-overview"
  )
}

function isReadOnlyPostRoute(path: string) {
  return (
    path === "/diagnostics/desktop-fetch" ||
    path === "/dom/query" ||
    path === "/dom/wait" ||
    path === "/ui/query" ||
    path === "/ui/read-text" ||
    path === "/ui/wait" ||
    path === "/browser/snapshot" ||
    path === "/browser/screenshot" ||
    path === "/browser/read-page" ||
    path === "/browser/extract-resource" ||
    path === "/browser/capture-element" ||
    path === "/browser/console" ||
    path === "/browser/network" ||
    path === "/browser/list-cached-resources"
  )
}

function capabilityRank(value: AutomationCapability) {
  if (value === "read_only") return 0
  if (value === "session_control") return 1
  if (value === "browser_control") return 2
  return 3
}

function secureEqual(value: string | undefined, expected: string) {
  if (!value) return false
  const valueBytes = Buffer.from(value)
  const expectedBytes = Buffer.from(expected)
  if (valueBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(valueBytes, expectedBytes)
}

function requireSingleHeader(value: string | string[] | undefined, name: string) {
  const header = optionalSingleHeader(value, name)
  if (header) return header
  throw forbiddenSource(name)
}

function optionalSingleHeader(value: string | string[] | undefined, name: string) {
  if (value === undefined) return undefined
  if (typeof value === "string" && value.length > 0) return value
  throw forbiddenSource(name)
}

function parseURL(value: string, header: string) {
  if (!URL.canParse(value)) throw forbiddenSource(header)
  return new URL(value)
}

function resolvedPort(url: URL) {
  if (url.port) return Number(url.port)
  return url.protocol === "https:" ? 443 : 80
}

function forbiddenSource(header: string) {
  return new AutomationHttpError(403, "invalid_request_source", `Forbidden ${header}`)
}

function parseContentLength(value: string | undefined) {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new AutomationHttpError(400, "invalid_content_length", "Invalid Content-Length")
  const length = Number(value)
  if (!Number.isSafeInteger(length)) {
    throw new AutomationHttpError(400, "invalid_content_length", "Invalid Content-Length")
  }
  return length
}

async function collectBody(request: IncomingMessage, limitBytes: number, timeoutMs: number) {
  const chunks: Buffer[] = []
  const read = (async () => {
    let size = 0
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > limitBytes) {
        throw new AutomationHttpError(413, "body_too_large", "Request body is too large")
      }
      chunks.push(bytes)
    }
    return chunks
  })()
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new AutomationHttpError(408, "body_timeout", "Request body timed out"))
      request.pause()
    }, timeoutMs)
    read.finally(() => clearTimeout(timer)).catch(() => undefined)
  })
  return await Promise.race([read, timeout])
}
