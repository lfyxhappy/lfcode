import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CorsMiddleware } from "../../../lfcode/src/server/middleware"

const mainDir = path.dirname(fileURLToPath(import.meta.url))

describe("desktop local server CORS", () => {
  test("allows the actual packaged renderer origin", async () => {
    const origins = await desktopServerOrigins()
    expect(await rendererOrigin()).toBe("oc://renderer")
    expect(origins).toEqual(["oc://renderer"])

    const response = await requestWithOrigin(origins, "oc://renderer")
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("oc://renderer")
  })

  test("does not allow the retired lfcode renderer origin", async () => {
    const response = await requestWithOrigin(await desktopServerOrigins(), "lfcode://renderer")
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("does not reflect an arbitrary origin", async () => {
    const response = await requestWithOrigin(await desktopServerOrigins(), "https://attacker.example")
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("rejects arbitrary and retired origins during preflight", async () => {
    const origins = await desktopServerOrigins()
    const retired = await preflightWithOrigin(origins, "lfcode://renderer")
    const arbitrary = await preflightWithOrigin(origins, "https://attacker.example")
    expect(retired.headers.get("access-control-allow-origin")).toBeNull()
    expect(arbitrary.headers.get("access-control-allow-origin")).toBeNull()
  })
})

async function rendererOrigin() {
  const source = await Bun.file(path.join(mainDir, "windows.ts")).text()
  const protocol = source.match(/const rendererProtocol = ["']([^"']+)["']/)?.[1]
  const host = source.match(/const rendererHost = ["']([^"']+)["']/)?.[1]
  expect(protocol).toBeDefined()
  expect(host).toBeDefined()
  return `${protocol}://${host}`
}

async function desktopServerOrigins() {
  const source = await Bun.file(path.join(mainDir, "server.ts")).text()
  const match = source.match(/cors:\s*\[\s*["']([^"']+)["']\s*\]/)
  expect(match).not.toBeNull()
  return [match![1]]
}

function corsApp(origins: string[]) {
  return new Hono().use(CorsMiddleware({ cors: origins })).get("/probe", (context) => context.text("ok"))
}

function requestWithOrigin(origins: string[], origin: string) {
  return corsApp(origins).request("http://localhost/probe", { headers: { origin } })
}

function preflightWithOrigin(origins: string[], origin: string) {
  return corsApp(origins).request("http://localhost/probe", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "GET",
      origin,
    },
  })
}
