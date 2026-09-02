import { createServer, request } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, test } from "bun:test"
import {
  AUTOMATION_BODY_LIMIT_BYTES,
  automationErrorResponse,
  browserAutomationError,
  automationRequestNeedsAuth,
  createAutomationToken,
  isAutomationRequestAuthorized,
  minimumAutomationCapability,
  readAutomationRequestBody,
  requireAutomationCapability,
  validateAutomationRequestSource,
} from "./automation-security"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        }),
    ),
  )
})

describe("automation request security", () => {
  test("exposes actionable browser failure codes without page data", () => {
    expect(automationErrorResponse(browserAutomationError("browser_target_missing"))).toEqual({
      status: 404,
      error: "No active side browser tab exists for this session.",
      logCode: "browser_target_missing",
      code: "browser_target_missing",
      retryable: false,
      recovery: "Open or bind a side browser tab for this session, then retry.",
    })
    expect(automationErrorResponse(browserAutomationError("browser_bridge_unavailable"))).toMatchObject({
      status: 503,
      code: "browser_bridge_unavailable",
      retryable: true,
    })
    expect(automationErrorResponse(browserAutomationError("browser_navigation_failed"))).toEqual({
      status: 502,
      error: "The side browser could not navigate to the requested page.",
      logCode: "browser_navigation_failed",
      code: "browser_navigation_failed",
      retryable: true,
      recovery: "Retry the browser request. If it keeps failing, reopen the side browser tab.",
    })
    expect(automationErrorResponse(browserAutomationError("navigation_timeout"))).toMatchObject({
      status: 504,
      code: "navigation_timeout",
      retryable: true,
    })
  })
  test("generates cryptographically sized unique tokens", () => {
    const tokens = Array.from({ length: 64 }, () => createAutomationToken())
    expect(new Set(tokens).size).toBe(tokens.length)
    expect(tokens.every((token) => token.length >= 43)).toBe(true)
  })

  test("keeps only the minimal health route unauthenticated", () => {
    expect(automationRequestNeedsAuth("GET", "/health")).toBe(false)
    expect(automationRequestNeedsAuth("POST", "/health")).toBe(true)
    expect(automationRequestNeedsAuth("GET", "/windows")).toBe(true)
    expect(automationRequestNeedsAuth("GET", "/diagnostics/events")).toBe(true)
    expect(automationRequestNeedsAuth("GET", "/browser/target")).toBe(true)
    expect(automationRequestNeedsAuth("GET", "/unknown")).toBe(true)
  })

  test("accepts only exact loopback Host and Origin values", () => {
    expect(() => validateAutomationRequestSource({ host: "127.0.0.1:7777" }, 7777)).not.toThrow()
    expect(() =>
      validateAutomationRequestSource({ host: "localhost:7777", origin: "http://localhost:7777" }, 7777),
    ).not.toThrow()
    expect(() => validateAutomationRequestSource({ host: "attacker.example:7777" }, 7777)).toThrow("Forbidden Host")
    expect(() => validateAutomationRequestSource({ host: "127.0.0.1:7778" }, 7777)).toThrow("Forbidden Host")
    expect(() =>
      validateAutomationRequestSource({ host: "127.0.0.1:7777", origin: "https://attacker.example" }, 7777),
    ).toThrow("Forbidden Origin")
    expect(() =>
      validateAutomationRequestSource({ host: "127.0.0.1:7777", origin: "http://localhost:7778" }, 7777),
    ).toThrow("Forbidden Origin")
  })

  test("checks bearer and legacy tokens without accepting malformed headers", () => {
    const token = createAutomationToken()
    expect(isAutomationRequestAuthorized({ authorization: `Bearer ${token}` }, token)).toBe(true)
    expect(isAutomationRequestAuthorized({ "x-lfcode-automation-token": token }, token)).toBe(true)
    expect(isAutomationRequestAuthorized({ authorization: `Bearer ${token} extra` }, token)).toBe(false)
    expect(isAutomationRequestAuthorized({ authorization: "Bearer wrong" }, token)).toBe(false)
  })

  test("enforces capability levels on the server route vocabulary", () => {
    expect(minimumAutomationCapability("GET", "/meta")).toBe("read_only")
    expect(minimumAutomationCapability("GET", "/diagnostics/ui-state")).toBe("read_only")
    expect(minimumAutomationCapability("GET", "/diagnostics/events/next")).toBe("read_only")
    expect(minimumAutomationCapability("POST", "/ui/query")).toBe("read_only")
    expect(minimumAutomationCapability("POST", "/ui/wait")).toBe("read_only")
    expect(minimumAutomationCapability("POST", "/session/open")).toBe("session_control")
    expect(minimumAutomationCapability("POST", "/browser/click")).toBe("browser_control")
    expect(minimumAutomationCapability("POST", "/ui/type")).toBe("full_app_control")
    expect(() => requireAutomationCapability("read_only", "POST", "/session/open")).toThrow("Forbidden")
    expect(() => requireAutomationCapability("session_control", "POST", "/session/open")).not.toThrow()
    expect(() => requireAutomationCapability("browser_control", "POST", "/browser/click")).not.toThrow()
    expect(() => requireAutomationCapability("browser_control", "POST", "/ui/type")).toThrow("Forbidden")
  })

  test("authenticates before reading a body and rejects malformed or oversized input", async () => {
    const token = createAutomationToken()
    let bodyReads = 0
    const server = createServer(async (incoming, response) => {
      try {
        const port = (server.address() as AddressInfo).port
        validateAutomationRequestSource(incoming.headers, port)
        if (!isAutomationRequestAuthorized(incoming.headers, token)) {
          response.writeHead(401, { connection: "close" })
          response.end("Unauthorized")
          return
        }
        bodyReads++
        const body = await readAutomationRequestBody(incoming, { limitBytes: 16, timeoutMs: 100 })
        response.end(JSON.stringify(body))
      } catch (error) {
        const failure = automationErrorResponse(error)
        response.writeHead(failure.status, { connection: "close" })
        response.end(failure.error)
      }
    })
    servers.push(server)
    await listen(server)
    const port = (server.address() as AddressInfo).port

    expect((await send(port, "/test", "POST", "{\"value\":1}")).status).toBe(401)
    expect(bodyReads).toBe(0)
    expect((await send(port, "/test", "POST", "not-json", token)).status).toBe(400)
    expect((await send(port, "/test", "POST", "{\"value\":\"0123456789\"}", token)).status).toBe(413)
    expect(await send(port, "/test", "POST", "{\"ok\":true}", token)).toMatchObject({
      status: 200,
      body: "{\"ok\":true}",
    })
    expect(bodyReads).toBe(3)
  })

  test("uses a strict default body limit", () => {
    expect(AUTOMATION_BODY_LIMIT_BYTES).toBe(1024 * 1024)
  })

  test("rejects a body that does not finish before the timeout", async () => {
    const server = createServer(async (incoming, response) => {
      try {
        await readAutomationRequestBody(incoming, { timeoutMs: 30 })
        response.end("unexpected")
      } catch (error) {
        const failure = automationErrorResponse(error)
        response.writeHead(failure.status, { connection: "close" })
        response.end(failure.error)
      }
    })
    servers.push(server)
    await listen(server)
    expect(await sendSlowBody((server.address() as AddressInfo).port)).toMatchObject({
      status: 408,
      body: "Request body timed out",
    })
  })
})

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function send(port: number, path: string, method: string, body: string, token?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-length": Buffer.byteLength(body),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        )
      },
    )
    outgoing.once("error", reject)
    outgoing.end(body)
  })
}

function sendSlowBody(port: number) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path: "/slow",
        method: "POST",
        headers: { "content-length": 10 },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.on("end", () => {
          outgoing.destroy()
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      },
    )
    outgoing.once("error", reject)
    outgoing.write("{")
  })
}
