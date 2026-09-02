import { describe, expect, test } from "bun:test"
import { LfApi } from "@/provider/lfapi"

describe("LFAPI model discovery", () => {
  test("reads and deduplicates the OpenAI-compatible catalog", async () => {
    const result = await LfApi.discover({
      apiKey: "temporary-key",
      fetch: async (input, init) => {
        expect(String(input)).toBe(LfApi.MODELS_URL)
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer temporary-key")
        return Response.json({ data: [{ id: "model-a", name: "Model A" }, { id: "model-a" }, { id: "model-b" }] })
      },
    })
    expect(result).toEqual({
      ok: true,
      source: "temporary",
      models: [
        { id: "model-a", name: "Model A", protocol: "openai-chat" },
        { id: "model-b", name: "model-b", protocol: "openai-chat" },
      ],
    })
  })

  test.each([
    [undefined, undefined, "missing_api_key"],
    ["key", 401, "unauthorized"],
    ["key", 403, "unauthorized"],
    ["key", 500, "network"],
  ] as const)("returns safe error %s", async (apiKey, status, error) => {
    const result = await LfApi.discover({ apiKey, fetch: async () => new Response("", { status: status ?? 200 }) })
    expect(result).toEqual({ ok: false, models: [], error })
  })

  test("rejects malformed and oversized catalogs", async () => {
    await expect(
      LfApi.discover({ apiKey: "key", fetch: async () => Response.json({ data: { id: "bad" } }) }),
    ).resolves.toEqual({ ok: false, models: [], error: "invalid_response" })
    await expect(
      LfApi.discover({ apiKey: "key", fetch: async () => new Response("{}", { headers: { "content-length": String(LfApi.MAX_BYTES + 1) } }) }),
    ).resolves.toEqual({ ok: false, models: [], error: "invalid_response" })
  })
})

describe("LFAPI persisted configuration", () => {
  test("accepts the fixed endpoint and supported protocols", () => {
    expect(() =>
      LfApi.assertConfiguration({
        protocol: "openai-chat",
        options: { baseURL: LfApi.BASE_URL },
        models: { chat: { protocol: "openai-chat" }, responses: { protocol: "openai-responses" } },
      }),
    ).not.toThrow()
  })

  test.each([
    { options: { baseURL: "https://other.example/v1" }, models: { chat: { protocol: "openai-chat" } } },
    { options: { baseURL: LfApi.BASE_URL }, protocol: "anthropic-messages", models: { chat: { protocol: "openai-chat" } } },
    { options: { baseURL: LfApi.BASE_URL }, models: { chat: { protocol: "gemini" } } },
  ])("rejects invalid configuration", (input) => {
    expect(() => LfApi.assertConfiguration(input)).toThrow("LFAPI")
  })
})
