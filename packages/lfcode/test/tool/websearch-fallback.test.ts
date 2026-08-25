import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { runLegacyWebSearchWithFallback } from "../../src/tool/websearch/fallback"

const payload = (text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })

const run = (responses: Record<string, Response>, compatProvider?: "exa" | "parallel") => {
  const requested: string[] = []
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requested.push(request.url)
      const response = request.url.includes("parallel.ai") ? responses.parallel : responses.exa
      return HttpClientResponse.fromWeb(request, response ?? new Response("missing", { status: 500 }))
    }),
  )
  return {
    requested,
    result: Effect.runPromise(
      runLegacyWebSearchWithFallback({
        http,
        sessionID: "ses_websearch_fallback",
        query: { query: "Lfcode search", compatProvider },
      }),
    ),
  }
}

describe("legacy websearch fallback", () => {
  test("requires an explicit compatibility provider", async () => {
    const search = run({})
    await expect(search.result).rejects.toMatchObject({ classification: "missing_credentials" })
    expect(search.requested).toHaveLength(0)
  })

  test("stops after a successful Exa response and emits structured sources", async () => {
    const search = run({
      exa: new Response(payload("[RFC](https://www.rfc-editor.org/rfc/rfc9110.html)"), { status: 200 }),
    }, "exa")

    await expect(search.result).resolves.toMatchObject({
      provider: "exa",
      route: "compat",
      attemptedProviders: ["exa"],
      sources: [{ domain: "www.rfc-editor.org", sourceTier: "primary" }],
    })
    expect(search.requested).toHaveLength(1)
  })

  test("does not fall back from an explicitly selected Exa provider", async () => {
    const search = run({
      exa: new Response("unavailable", { status: 503 }),
      parallel: new Response(payload("[Example](https://example.com/research)"), { status: 200 }),
    }, "exa")

    await expect(search.result).rejects.toMatchObject({ provider: "exa", classification: "http_5xx" })
    expect(search.requested).toHaveLength(1)
  })

  test("keeps an explicitly selected Parallel provider independent", async () => {
    const search = run({
      parallel: new Response(payload("[Docs](https://docs.example.com/guide)"), { status: 200 }),
    }, "parallel")

    await expect(search.result).resolves.toMatchObject({
      provider: "parallel",
      attemptedProviders: ["parallel"],
    })
  })
})
