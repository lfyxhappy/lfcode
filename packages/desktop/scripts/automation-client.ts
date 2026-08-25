#!/usr/bin/env bun
import { readAutomationDiscovery, resolveAutomationStateFile } from "../src/automation-discovery"
import { automationRequestNeedsAuth, isLoopbackAutomationHost } from "../src/automation-security"

type Method = "GET" | "POST"

type ResponseEnvelope<T = unknown> = {
  ok?: boolean
  data?: T
  error?: string
  code?: string
  requestID?: string
  timestamp?: string
  retryable?: boolean
  recovery?: string
}

type ClientOptions = {
  host?: string
  port?: number
  token?: string
}

export type AutomationMetadata = {
  protocolVersion: number
  instanceID: string
  pid: number
  startedAt: number
  version: string
  capability: string
  features: string[]
}

type AutomationClientErrorDetails = {
  status?: number
  code?: string
  requestID?: string
  retryable?: boolean
  recovery?: string
}

export class AutomationClientError extends Error {
  readonly status?: number
  readonly code?: string
  readonly requestID?: string
  readonly retryable?: boolean
  readonly recovery?: string

  constructor(message: string, input?: AutomationClientErrorDetails) {
    super(message)
    this.name = "AutomationClientError"
    this.status = input?.status
    this.code = input?.code
    this.requestID = input?.requestID
    this.retryable = input?.retryable
    this.recovery = input?.recovery
  }
}

export async function createAutomationClient(options?: ClientOptions, env = process.env) {
  const envPort = Number(env.LFCODE_AUTOMATION_PORT || "0")
  const discovered =
    options?.port || (Number.isFinite(envPort) && envPort > 0)
      ? undefined
      : await readAutomationDiscovery(env).catch(() => undefined)
  const host = options?.host ?? discovered?.host ?? env.LFCODE_AUTOMATION_HOST ?? "127.0.0.1"
  const port = options?.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : discovered?.port)
  const token =
    options?.token ??
    (env.LFCODE_AUTOMATION_TOKEN
      ? env.LFCODE_AUTOMATION_TOKEN
      : discovered?.token
        ? discovered.token
        : "")
  if (!port) {
    throw new AutomationClientError(
      `Missing automation port. Start the desktop app or set LFCODE_AUTOMATION_PORT. Discovery file: ${resolveAutomationStateFile(env)}`,
      { code: "automation_port_missing", retryable: true },
    )
  }
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new AutomationClientError("Invalid automation port", { code: "automation_port_invalid" })
  }
  if (!isLoopbackAutomationHost(host)) {
    throw new AutomationClientError("Automation client only accepts loopback hosts", { code: "automation_host_invalid" })
  }

  const request = async <T>(method: Method, path: string, body?: unknown) => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      throw new AutomationClientError("Automation request path must be an absolute local path", {
        code: "automation_request_path_invalid",
      })
    }
    const requestPath = new URL(path, "http://127.0.0.1").pathname
    const needsAuth = automationRequestNeedsAuth(method, requestPath)
    if (needsAuth && !token) {
      throw new AutomationClientError("Missing automation token", { code: "automation_token_missing" })
    }
    const hasBody = body !== undefined
    const response = await fetch(automationURL(host, port, path), {
      method,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(needsAuth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    }).catch(() => {
      throw new AutomationClientError(
        `Automation request failed: ${method} ${path}`,
        {
          code: "automation_request_unreachable",
          retryable: true,
          recovery: "Keep the desktop app open, then retry the automation request.",
        },
      )
    })
    const raw = await response.json().catch(() => {
      throw new AutomationClientError(`Automation server returned an invalid response: ${method} ${path}`, {
        status: response.status,
        code: "automation_response_invalid",
        retryable: response.status >= 500,
      })
    })
    if (!isRecord(raw)) {
      throw new AutomationClientError(`Automation server returned an invalid response: ${method} ${path}`, {
        status: response.status,
        code: "automation_response_invalid",
        retryable: response.status >= 500,
      })
    }
    const payload = raw as ResponseEnvelope<T>
    if (!response.ok || !payload.ok) {
      throw new AutomationClientError(typeof payload.error === "string" ? payload.error : `Automation request failed: ${method} ${path}`, {
        status: response.status,
        code: typeof payload.code === "string" ? payload.code : `automation_http_${response.status}`,
        requestID: typeof payload.requestID === "string" ? payload.requestID : undefined,
        retryable: typeof payload.retryable === "boolean" ? payload.retryable : response.status >= 500,
        recovery: typeof payload.recovery === "string" ? payload.recovery : undefined,
      })
    }
    return payload.data as T
  }

  return {
    host,
    port,
    token,
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    getMetadata: () => request<AutomationMetadata>("GET", "/meta"),
  }
}

export async function automationMain() {
  const [method = "GET", path = "/health", bodyText] = process.argv.slice(2)
  const client = await createAutomationClient()
  const body = bodyText ? JSON.parse(bodyText) : undefined
  const data = method.toUpperCase() === "POST" ? await client.post(path, body) : await client.get(path)
  console.log(JSON.stringify(data, null, 2))
}

if (import.meta.main) {
  await automationMain()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function automationURL(host: string, port: number, path: string) {
  const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
  return `http://${hostname}:${port}${path}`
}
