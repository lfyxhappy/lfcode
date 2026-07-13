import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { getWebSearchProviderOrder } from "@lfcode-ai/shared/web-search"
import { runLegacyWebSearchWithFallback } from "../../src/tool/websearch/fallback"

const payload = (text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })

const run = (responses: Record<string, Response>) => {
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
        query: { query: "Lfcode search" },
      }),
    ),
  }
}

describe("legacy websearch fallback", () => {
  test("keeps the deterministic Exa then Parallel policy", () => {
    expect(getWebSearchProviderOrder()).toEqual(["exa", "parallel"])
    expect(getWebSearchProviderOrder("parallel")).toEqual(["parallel"])
  })

  test("stops after a successful Exa response and emits structured sources", async () => {
    const search = run({
      exa: new Response(payload("[RFC](https://www.rfc-editor.org/rfc/rfc9110.html)"), { status: 200 }),
    })

    await expect(search.result).resolves.toMatchObject({
      provider: "exa",
      attemptedProviders: ["exa"],
      sources: [{ domain: "www.rfc-editor.org", sourceTier: "primary" }],
    })
    expect(search.requested).toHaveLength(1)
  })

  test("falls back after an Exa 5xx response", async () => {
    const search = run({
      exa: new Response("unavailable", { status: 503 }),
      parallel: new Response(payload("[Example](https://example.com/research)"), { status: 200 }),
    })

    await expect(search.result).resolves.toMatchObject({
      provider: "parallel",
      attemptedProviders: ["exa", "parallel"],
      warnings: ["exa:http_5xx (503)"],
    })
    expect(search.requested).toHaveLength(2)
  })

  test("treats an empty provider payload as retryable", async () => {
    const search = run({
      exa: new Response(payload(""), { status: 200 }),
      parallel: new Response(payload("[Docs](https://docs.example.com/guide)"), { status: 200 }),
    })

    await expect(search.result).resolves.toMatchObject({
      provider: "parallel",
      warnings: ["exa:empty_response"],
    })
  })
})
