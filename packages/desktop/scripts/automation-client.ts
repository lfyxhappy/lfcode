#!/usr/bin/env bun
import { readAutomationDiscovery, resolveAutomationStateFile } from "../src/automation-discovery"
import { automationRequestNeedsAuth, isLoopbackAutomationHost } from "../src/automation-security"

type Method = "GET" | "POST"

type ResponseEnvelope<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
  requestID: string
  timestamp: string
}

type ClientOptions = {
  host?: string
  port?: number
  token?: string
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
    throw new Error(
      `Missing automation port. Start the desktop app or set LFCODE_AUTOMATION_PORT. Discovery file: ${resolveAutomationStateFile(env)}`,
    )
  }
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) throw new Error("Invalid automation port")
  if (!isLoopbackAutomationHost(host)) throw new Error("Automation client only accepts loopback hosts")

  const request = async <T>(method: Method, path: string, body?: unknown) => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      throw new Error("Automation request path must be an absolute local path")
    }
    if (automationRequestNeedsAuth(method, new URL(path, "http://127.0.0.1").pathname) && !token) {
      throw new Error("Missing automation token")
    }
    const hasBody = body !== undefined
    const response = await fetch(`http://${host}:${port}${path}`, {
      method,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(automationRequestNeedsAuth(method, new URL(path, "http://127.0.0.1").pathname)
          ? { authorization: `Bearer ${token}` }
          : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    })
    const payload = (await response.json()) as ResponseEnvelope<T>
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? `Automation request failed: ${method} ${path}`)
    }
    return payload.data as T
  }

  return {
    host,
    port,
    token,
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
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
