import { afterEach, describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AppControlRequestError,
  AutomationClientConfigurationError,
  AutomationServiceUnavailableError,
  createAppControlClient,
} from "../src/app-control/client"

const environmentKeys = [
  "LFCODE_AUTOMATION_HOST",
  "LFCODE_AUTOMATION_PORT",
  "LFCODE_AUTOMATION_TOKEN",
  "LFCODE_AUTOMATION_STATE_FILE",
] as const
const environment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of environmentKeys) {
    const value = environment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("app control client", () => {
  test("rejects a tampered discovery endpoint before it can make a request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lfcode-app-control-client-"))
    const discovery = join(directory, "desktop.json")
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      throw new Error("fetch should not run")
    }) as unknown as typeof fetch
    process.env.LFCODE_AUTOMATION_STATE_FILE = discovery
    delete process.env.LFCODE_AUTOMATION_HOST
    delete process.env.LFCODE_AUTOMATION_PORT
    delete process.env.LFCODE_AUTOMATION_TOKEN

    try {
      await writeFile(
        discovery,
        JSON.stringify({
          host: "attacker.example",
          pid: 1234,
          port: 45731,
          startedAt: Date.now(),
          token: "automation-secret",
          userData: directory,
          version: "1.0.0",
        }),
      )
      await expect(createAppControlClient()).rejects.toBeInstanceOf(AutomationServiceUnavailableError)
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { force: true, recursive: true })
    }
  })

  test("rejects a non-loopback explicit endpoint before it can make a request", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      throw new Error("fetch should not run")
    }) as unknown as typeof fetch

    try {
      await expect(createAppControlClient({ host: "attacker.example", port: 45731, token: "automation-secret" })).rejects.toBeInstanceOf(
        AutomationClientConfigurationError,
      )
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("omits the bearer token from health but sends it to authenticated routes", async () => {
    const received: Array<{ path: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      received.push({ path: request.url ?? "/", authorization: request.headers.authorization })
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ ok: true, data: { status: "ok" } }))
    })
    const port = await listen(server)

    try {
      const client = await createAppControlClient({ host: "127.0.0.1", port, token: "automation-secret" })
      await client.get("/health")
      await client.get("/meta")
      expect(received).toEqual([
        { path: "/health", authorization: undefined },
        { path: "/meta", authorization: "Bearer automation-secret" },
      ])
    } finally {
      await close(server)
    }
  })

  test("verifies a versioned discovery record before using its endpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lfcode-app-control-client-"))
    const discovery = join(directory, "desktop.json")
    const received: string[] = []
    const server = createServer((request, response) => {
      received.push(request.url ?? "/")
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            protocolVersion: 2,
            instanceID: "different-instance",
            pid: 1234,
            startedAt: 123,
            version: "1.0.0",
            capability: "full_app_control",
            features: ["diagnostics.events.cursor"],
          },
        }),
      )
    })
    const port = await listen(server)
    process.env.LFCODE_AUTOMATION_STATE_FILE = discovery
    delete process.env.LFCODE_AUTOMATION_HOST
    delete process.env.LFCODE_AUTOMATION_PORT
    delete process.env.LFCODE_AUTOMATION_TOKEN

    try {
      await writeFile(
        discovery,
        JSON.stringify({
          host: "127.0.0.1",
          pid: 1234,
          port,
          startedAt: 123,
          token: "automation-secret",
          userData: directory,
          version: "1.0.0",
          protocolVersion: 2,
          instanceID: "recorded-instance",
        }),
      )
      const client = await createAppControlClient()
      await expect(client.get("/windows")).rejects.toMatchObject({ code: "automation_instance_mismatch" })
      expect(received).toEqual(["/meta"])
    } finally {
      await close(server)
      await rm(directory, { force: true, recursive: true })
    }
  })

  test("preserves structured desktop response errors", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(409, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: false,
          error: "Desktop target is still loading.",
          code: "target_not_ready",
          requestID: "req-123",
          retryable: true,
          recovery: "Wait and retry.",
        }),
      )
    })
    const port = await listen(server)

    try {
      const client = await createAppControlClient({ host: "127.0.0.1", port, token: "automation-secret" })
      await expect(client.get("/meta")).rejects.toMatchObject({
        name: "AppControlRequestError",
        details: {
          status: 409,
          code: "target_not_ready",
          requestID: "req-123",
          retryable: true,
          recovery: "Wait and retry.",
        },
      } satisfies Partial<AppControlRequestError>)
    } finally {
      await close(server)
    }
  })
})

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("automation stub did not expose a TCP port"))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
