import { describe, expect, test } from "bun:test"
import { OpenCode } from "@/provider/opencode"

describe("OpenCode Zen provider", () => {
  test("discovers unique models from the live OpenAI catalog", async () => {
    const result = await OpenCode.discover({
      fetch: async () => new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4" }, { id: "claude-sonnet-4" }, { id: "gpt-5" }] }), { status: 200 }),
    })
    expect(result).toEqual({
      ok: true,
      source: "stored",
      models: [
        {
        id: "claude-sonnet-4",
        name: "claude-sonnet-4",
        protocol: "openai-chat",
        reasoning_options: [{ type: "budget_tokens", min: 1024 }],
        capabilities: { reasoning: true, temperature: true, tool_call: true },
        },
        {
        id: "gpt-5",
        name: "gpt-5",
        protocol: "openai-chat",
        reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
        capabilities: { reasoning: true, temperature: false, tool_call: true },
        },
      ],
    })
  })

  test("derives capabilities from model names even when the catalog is stale", async () => {
    const result = await OpenCode.discover({
      fetch: async () =>
        Response.json({ data: [{ id: "mimo-v2.5", capabilities: { reasoning: false, temperature: true, tool_call: false } }] }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models[0].capabilities).toEqual({ reasoning: true, temperature: false, tool_call: true })
  })

  test("maps an unavailable usage endpoint to a safe error", async () => {
    const result = await OpenCode.usage({ storedApiKey: "redacted", fetch: async () => new Response("", { status: 404 }) })
    expect(result).toEqual({ ok: false, error: "invalid_response" })
  })

  test("requires the official endpoint and keeps protocol model-scoped", () => {
    expect(() => OpenCode.assertConfiguration({ options: { baseURL: "https://example.com/v1" } })).toThrow()
    expect(() =>
      OpenCode.assertConfiguration({
        options: { baseURL: OpenCode.BASE_URL },
        models: { model: { protocol: "anthropic-messages" } },
      }),
    ).toThrow()
    expect(() =>
      OpenCode.assertConfiguration({
        options: { baseURL: OpenCode.BASE_URL },
        models: { model: { protocol: "openai-chat", provider: { protocol: "anthropic-messages" } } },
      }),
    ).not.toThrow()
  })
})
