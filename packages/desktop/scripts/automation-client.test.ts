import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { writeAutomationDiscovery } from "../src/automation-discovery"
import { createAutomationClient } from "./automation-client"

const tempDirs: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
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

describe("automation client", () => {
  test("loads the token from discovery but never sends it to health", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lfcode-automation-client-"))
    tempDirs.push(directory)
    const token = "discovery-secret"
    const authorization: Array<string | undefined> = []
    const server = createServer((request, response) => {
      authorization.push(request.headers.authorization)
      const authorized = request.url === "/health" || request.headers.authorization === `Bearer ${token}`
      response.writeHead(authorized ? 200 : 401, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          ok: authorized,
          data: authorized ? (request.url === "/health" ? { status: "ok" } : [{ id: 1 }]) : undefined,
          error: authorized ? undefined : "Unauthorized",
          requestID: "test",
          timestamp: new Date().toISOString(),
        }),
      )
    })
    servers.push(server)
    await listen(server)
    const port = (server.address() as AddressInfo).port
    const env = { LFCODE_STATE_DIR: directory }
    await writeAutomationDiscovery(
      {
        host: "127.0.0.1",
        pid: process.pid,
        port,
        startedAt: Date.now(),
        token,
        userData: directory,
        version: "test",
      },
      env,
    )

    const client = await createAutomationClient(undefined, env)
    expect(await client.get("/health")).toEqual({ status: "ok" })
    expect(await client.get("/windows")).toEqual([{ id: 1 }])
    expect(authorization).toEqual([undefined, `Bearer ${token}`])
  })

  test("rejects non-loopback hosts and protected requests without a token", async () => {
    await expect(createAutomationClient({ host: "attacker.example", port: 7777 }, {})).rejects.toThrow("loopback")
    const client = await createAutomationClient({ host: "127.0.0.1", port: 7777 }, {})
    await expect(client.get("/windows")).rejects.toThrow("Missing automation token")
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
