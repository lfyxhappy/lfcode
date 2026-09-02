import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Server } from "@/server/server"
import { tmpdir } from "../fixture/fixture"

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Instance.disposeAll()
})

describe("provider quota routes", () => {
  test("reads the saved DeepSeek API key without returning it", async () => {
    await using tmp = await tmpdir({ git: true })
    const apiKey = "deepseek-route-test-key"
    let authorization = ""
    let requestedURL = ""

    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const auth = yield* Auth.Service
            yield* auth.set("deepseek", { type: "api", key: apiKey })
          }),
        ),
    })

    globalThis.fetch = (async (input, init) => {
      requestedURL = String(input)
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return Response.json({
        is_available: true,
        balance_infos: [
          { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
        ],
      })
    }) as typeof globalThis.fetch

    const response = await Server.Default().app.request("/provider/deepseek/usage", {
      headers: { "x-lfcode-directory": tmp.path },
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(requestedURL).toBe("https://api.deepseek.com/user/balance")
    expect(authorization).toBe(`Bearer ${apiKey}`)
    expect(body).toMatchObject({
      ok: true,
      usage: {
        balance: { available: 110, total: 110, granted: 10, cash: 100, currency: "CNY", isAvailable: true },
        windows: [],
        source: "deepseek",
      },
    })
    expect(JSON.stringify(body)).not.toContain(apiKey)
  })
})
