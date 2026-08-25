import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import fs from "node:fs/promises"
import { Flag } from "../../src/flag/flag"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const envKeys = [
  "LFCODE_AUTOMATION_HOST",
  "LFCODE_AUTOMATION_PORT",
  "LFCODE_AUTOMATION_TOKEN",
  "LFCODE_AUTOMATION_STATE_FILE",
] as const

const envSnapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
const authSnapshot = {
  password: Flag.LFCODE_SERVER_PASSWORD,
  username: Flag.LFCODE_SERVER_USERNAME,
}

afterEach(() => {
  for (const key of envKeys) {
    const previous = envSnapshot[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  Flag.LFCODE_SERVER_PASSWORD = authSnapshot.password
  Flag.LFCODE_SERVER_USERNAME = authSnapshot.username
})

describe("global app-control routes", () => {
  test("GET /global/app-control/meta proxies authenticated protocol metadata", async () => {
    const requests: Array<{ method: string; url: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        authorization: request.headers.authorization,
      })
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            protocolVersion: 2,
            instanceID: "desktop-instance-1",
            pid: 1234,
            startedAt: 1_700_000_000_000,
            version: "1.2.3",
            capability: "full_app_control",
            features: ["diagnostics.events.cursor"],
          },
        }),
      )
    })

    try {
      const port = await listen(server)
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = "metadata-token"

      const response = await Server.Default().app.request("/global/app-control/meta")
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data).toEqual({
        protocolVersion: 2,
        instanceID: "desktop-instance-1",
        pid: 1234,
        startedAt: 1_700_000_000_000,
        version: "1.2.3",
        capability: "full_app_control",
        features: ["diagnostics.events.cursor"],
      })
      expect(requests).toEqual([
        {
          method: "GET",
          url: "/meta",
          authorization: "Bearer metadata-token",
        },
      ])
    } finally {
      await closeServer(server)
    }
  })

  test("global server authentication rejects unauthenticated metadata requests before proxying", async () => {
    const requests: Array<{ authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({ authorization: request.headers.authorization })
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            protocolVersion: 2,
            instanceID: "desktop-instance-auth",
            pid: 1234,
            startedAt: 1_700_000_000_000,
            version: "1.2.3",
            capability: "read_only",
            features: [],
          },
        }),
      )
    })

    try {
      const port = await listen(server)
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = "desktop-token"
      Flag.LFCODE_SERVER_USERNAME = "automation-test"
      Flag.LFCODE_SERVER_PASSWORD = "server-password"

      const rejected = await Server.Default().app.request("/global/app-control/meta")
      expect(rejected.status).toBe(401)
      expect(requests).toHaveLength(0)

      const accepted = await Server.Default().app.request("/global/app-control/meta", {
        headers: {
          authorization: `Basic ${Buffer.from("automation-test:server-password").toString("base64")}`,
        },
      })
      expect(accepted.status).toBe(200)
      expect(requests).toEqual([{ authorization: "Bearer desktop-token" }])
    } finally {
      await closeServer(server)
    }
  })

  test("GET /global/app-control/events/next proxies cursor filters and event envelopes", async () => {
    const requests: Array<{ method: string; url: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        authorization: request.headers.authorization,
      })
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            events: [
              {
                id: 42,
                at: 1_700_000_000_100,
                timestamp: 1_700_000_000_100,
                isoTime: "2023-11-14T22:13:20.100Z",
                scope: "renderer",
                type: "session.updated",
                windowID: 5,
                data: { sessionID: "ses_demo" },
              },
            ],
            nextCursor: 42,
            oldestID: 40,
            latestID: 42,
            resetRequired: false,
          },
        }),
      )
    })

    try {
      const port = await listen(server)
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = "cursor-token"

      const response = await Server.Default().app.request(
        "/global/app-control/events/next?after=41&scope=renderer&type=session.updated&limit=3&waitMs=250",
      )
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data).toEqual({
        events: [
          expect.objectContaining({
            id: 42,
            at: 1_700_000_000_100,
            timestamp: 1_700_000_000_100,
            scope: "renderer",
            type: "session.updated",
          }),
        ],
        nextCursor: 42,
        oldestID: 40,
        latestID: 42,
        resetRequired: false,
      })
      expect(requests).toEqual([
        {
          method: "GET",
          url: "/diagnostics/events/next?after=41&scope=renderer&type=session.updated&limit=3&waitMs=250",
          authorization: "Bearer cursor-token",
        },
      ])
    } finally {
      await closeServer(server)
    }
  })

  test("GET /global/app-control/events proxies filters to the desktop automation server", async () => {
    const requests: Array<{ method: string; url: string; authorization?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        authorization: request.headers.authorization,
      })
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(
        JSON.stringify({
          ok: true,
          data: [
            {
              id: 7,
              scope: "server",
              type: "response",
              timestamp: Date.now(),
              data: { status: 200, durationMs: 12 },
            },
          ],
        }),
      )
    })

    try {
      const port = await listen(server)
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = "route-token"

      const response = await Server.Default().app.request("/global/app-control/events?scope=server&type=response&limit=12")
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect("data" in payload ? payload.data : payload).toEqual([
        expect.objectContaining({
          id: 7,
          scope: "server",
          type: "response",
        }),
      ])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe("GET")
      expect(requests[0]?.url).toBe("/diagnostics/events?scope=server&type=response&limit=12")
      expect(requests[0]?.authorization).toBe("Bearer route-token")
    } finally {
      await closeServer(server)
    }
  })

  test("POST /global/app-control/diagnostics-bundle/export captures and writes a desktop diagnostics bundle", async () => {
    await using tmp = await tmpdir()
    const requests: Array<{ method: string; url: string; body?: string }> = []
    const server = createServer(async (request, response) => {
      const body = request.method === "POST" ? await readBody(request) : undefined
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        body,
      })

      if (request.method === "GET" && request.url === "/diagnostics/ui-state?windowID=9") {
        return respond(response, {
          ok: true,
          data: {
            window: { id: 9 },
            state: { sessionID: "ses_test" },
          },
        })
      }

      if (request.method === "GET" && request.url === "/diagnostics/events?limit=21") {
        return respond(response, {
          ok: true,
          data: [{ id: 1, scope: "server", type: "request", timestamp: Date.now() }],
        })
      }

      if (request.method === "POST" && request.url === "/capture/window") {
        return respond(response, {
          ok: true,
          data: {
            path: "C:/tmp/capture.png",
            window: { id: 9 },
          },
        })
      }

      response.writeHead(404, { "content-type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ ok: false, error: `Unexpected route: ${request.method} ${request.url}` }))
    })

    try {
      const port = await listen(server)
      process.env.LFCODE_AUTOMATION_HOST = "127.0.0.1"
      process.env.LFCODE_AUTOMATION_PORT = String(port)
      process.env.LFCODE_AUTOMATION_TOKEN = "export-token"

      const output = path.join(tmp.path, "diagnostics.json")
      const response = await Server.Default().app.request("/global/app-control/diagnostics-bundle/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: output,
          windowID: 9,
          eventLimit: 21,
          label: "route-test",
        }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data).toEqual({
        path: output,
        capturePath: "C:/tmp/capture.png",
      })

      const written = JSON.parse(await fs.readFile(output, "utf8")) as Record<string, unknown>
      expect(written.state).toEqual({
        window: { id: 9 },
        state: { sessionID: "ses_test" },
      })
      expect(written.events).toEqual([{ id: 1, scope: "server", type: "request", timestamp: expect.any(Number) }])
      expect(written.capture).toEqual({
        path: "C:/tmp/capture.png",
        window: { id: 9 },
      })

      expect(requests.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET /diagnostics/ui-state?windowID=9",
        "GET /diagnostics/events?limit=21",
        "POST /capture/window",
      ])
      expect(requests[2]?.body).toBe(JSON.stringify({ windowID: 9, label: "route-test" }))
    } finally {
      await closeServer(server)
    }
  })
})

function respond(response: ServerResponse<IncomingMessage>, payload: unknown) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(payload))
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Automation stub did not expose a TCP port"))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: ReturnType<typeof createServer>) {
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

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}
