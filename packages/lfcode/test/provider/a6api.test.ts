import { describe, expect, test } from "bun:test"
import { A6Api } from "@/provider/a6api"

describe("A6API model discovery", () => {
  test("filters the allowed model families and assigns their default protocols", async () => {
    const result = await A6Api.discover({
      apiKey: "temporary-key",
      fetch: async () =>
        Response.json({
          data: [
            { id: "GPT-5.6-Sol", name: "GPT 5.6 Sol" },
            { id: "grok-4.6-fast" },
            { id: "claude-5-opus" },
            { id: "deepseek-v4" },
            { id: "gpt-5.5" },
            { id: "claude-4-sonnet" },
          ],
        }),
    })

    expect(result).toEqual({
      ok: true,
      source: "temporary",
      models: [
        { id: "GPT-5.6-Sol", name: "GPT 5.6 Sol", protocol: "openai-responses" },
        { id: "grok-4.6-fast", name: "grok-4.6-fast", protocol: "openai-chat" },
        { id: "claude-5-opus", name: "claude-5-opus", protocol: "anthropic-messages" },
        { id: "deepseek-v4", name: "deepseek-v4", protocol: "openai-chat" },
      ],
    })
  })

  test("deduplicates repeated upstream model IDs", async () => {
    const result = await A6Api.discover({
      apiKey: "temporary-key",
      fetch: async () => Response.json({ data: [{ id: "deepseek-v4" }, { id: "deepseek-v4" }] }),
    })

    expect(result).toMatchObject({ ok: true, models: [{ id: "deepseek-v4" }] })
  })

  test("uses the stored credential without exposing it", async () => {
    let authorization: string | undefined
    const result = await A6Api.discover({
      storedApiKey: "stored-key",
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? undefined
        return Response.json({ data: [{ id: "deepseek-v4" }] })
      },
    })

    expect(authorization).toBe("Bearer stored-key")
    expect(result).toEqual({
      ok: true,
      source: "stored",
      models: [{ id: "deepseek-v4", name: "deepseek-v4", protocol: "openai-chat" }],
    })
    expect(JSON.stringify(result)).not.toContain("stored-key")
  })

  test.each([
    [undefined, undefined, "missing_api_key"],
    ["key", 401, "unauthorized"],
    ["key", 403, "unauthorized"],
    ["key", 500, "network"],
  ] as const)("returns the safe error category %s", async (apiKey, status, error) => {
    const result = await A6Api.discover({
      apiKey,
      fetch: async () => new Response("", { status: status ?? 200 }),
    })
    expect(result).toEqual({ ok: false, models: [], error })
  })

  test("rejects malformed upstream payloads without leaking their contents", async () => {
    const result = await A6Api.discover({
      apiKey: "key",
      fetch: async () => Response.json({ data: { id: "deepseek-v4", secret: "must-not-leak" } }),
    })
    expect(result).toEqual({ ok: false, models: [], error: "invalid_response" })
    expect(JSON.stringify(result)).not.toContain("must-not-leak")
  })

  test("rejects oversized model catalogs", async () => {
    const result = await A6Api.discover({
      apiKey: "key",
      fetch: async () => new Response("{}", { headers: { "content-length": "524289" } }),
    })

    expect(result).toEqual({ ok: false, models: [], error: "invalid_response" })
  })

  test("cancels an oversized catalog stream without a content length", async () => {
    let cancelled = false
    const result = await A6Api.discover({
      apiKey: "key",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(A6Api.A6API_MODELS_MAX_BYTES))
              controller.enqueue(new Uint8Array(1))
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
    })

    expect(result).toEqual({ ok: false, models: [], error: "invalid_response" })
    expect(cancelled).toBe(true)
  })

  test("maps an aborted upstream request to a safe network error", async () => {
    const controller = new AbortController()
    controller.abort("timeout")
    const result = await A6Api.discover({
      apiKey: "key",
      signal: controller.signal,
      fetch: async (_input, init) => {
        expect(init?.signal?.aborted).toBe(true)
        throw new DOMException("The operation timed out", "AbortError")
      },
    })

    expect(result).toEqual({ ok: false, models: [], error: "network" })
  })
})

describe("A6API persisted configuration", () => {
  test("accepts only the fixed endpoint and allowed model protocols", () => {
    expect(() =>
      A6Api.assertConfiguration({
        protocol: "openai-chat",
        options: { baseURL: A6Api.A6API_BASE_URL },
        models: {
          "gpt-5.6-sol": { protocol: "openai-responses" },
          "claude-5-opus": { protocol: "anthropic-messages" },
          "deepseek-v4": { protocol: "openai-chat" },
        },
      }),
    ).not.toThrow()
  })

  const invalidConfigurations: Parameters<typeof A6Api.assertConfiguration>[0][] = [
    {
      protocol: "openai-chat",
      options: { baseURL: "https://other.example/v1" },
      models: { "deepseek-v4": { protocol: "openai-chat" } },
    },
    {
      protocol: "gemini",
      options: { baseURL: A6Api.A6API_BASE_URL },
      models: { "deepseek-v4": { protocol: "openai-chat" } },
    },
    {
      protocol: "openai-chat",
      options: { baseURL: A6Api.A6API_BASE_URL },
      models: { "gpt-5.5": { protocol: "openai-chat" } },
    },
    {
      protocol: "openai-chat",
      options: { baseURL: A6Api.A6API_BASE_URL },
      models: { "deepseek-v4": { protocol: "gemini" } },
    },
  ]

  test.each(invalidConfigurations)("rejects a configuration that bypasses the A6API form contract", (input) => {
    expect(() => A6Api.assertConfiguration(input)).toThrow("A6API configuration")
  })
})
