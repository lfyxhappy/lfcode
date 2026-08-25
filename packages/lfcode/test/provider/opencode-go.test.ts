import { describe, expect, test } from "bun:test"
import { OpenCodeGo } from "@/provider/opencode-go"

describe("OpenCode Go provider", () => {
  test("discovers unique official models without returning the API key", async () => {
    let authorization: string | undefined
    const result = await OpenCodeGo.discover({
      storedApiKey: "stored-key",
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? undefined
        return Response.json({ data: [{ id: "gpt-5" }, { id: "gpt-5" }, { id: "claude-sonnet", name: "Claude Sonnet" }] })
      },
    })

    expect(authorization).toBe("Bearer stored-key")
    expect(result).toEqual({
      ok: true,
      source: "stored",
      models: [
        {
          id: "gpt-5",
          name: "gpt-5",
          protocol: "openai-chat",
          reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
          capabilities: { reasoning: true, temperature: false, tool_call: true },
        },
        {
          id: "claude-sonnet",
          name: "Claude Sonnet",
          protocol: "openai-chat",
          capabilities: { reasoning: true, temperature: true, tool_call: true },
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("stored-key")
  })

  test("ignores stale catalog capabilities and derives them from the model name", async () => {
    const result = await OpenCodeGo.discover({
      fetch: async () =>
        Response.json({
          data: [{ id: "mimo-v2.5", capabilities: { reasoning: false, temperature: true, tool_call: false } }],
        }),
    })
    expect(result).toEqual({
      ok: true,
      source: "stored",
      models: [
        {
          id: "mimo-v2.5",
          name: "mimo-v2.5",
          protocol: "openai-chat",
          reasoning_options: [{ type: "toggle" }],
          capabilities: { reasoning: true, temperature: false, tool_call: true },
        },
      ],
    })
  })

  test("reads all quota windows and keeps the API key private", async () => {
    let authorization: string | undefined
    const result = await OpenCodeGo.usage({
      storedApiKey: "stored-key",
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? undefined
        return Response.json({
          usage: {
            rolling: { status: "ok", percent: 12, resetsAt: "2026-08-22T00:00:00.000Z" },
            weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-25T00:00:00.000Z" },
            monthly: { status: "ok", percent: 54, resetsAt: "2026-09-01T00:00:00.000Z" },
          },
        })
      },
    })

    expect(authorization).toBe("Bearer stored-key")
    expect(result).toEqual({
      ok: true,
      usage: {
        rolling: { status: "ok", percent: 12, usedPercent: 12, remainingPercent: 88, resetsAt: "2026-08-22T00:00:00.000Z" },
        weekly: { status: "rate-limited", percent: 100, usedPercent: 100, remainingPercent: 0, resetsAt: "2026-08-25T00:00:00.000Z" },
        monthly: { status: "ok", percent: 54, usedPercent: 54, remainingPercent: 46, resetsAt: "2026-09-01T00:00:00.000Z" },
      },
    })
    expect(JSON.stringify(result)).not.toContain("stored-key")
  })

  test.each([
    [undefined, undefined, "missing_api_key"],
    ["key", 401, "unauthorized"],
    ["key", 403, "unauthorized"],
    ["key", 500, "network"],
  ] as const)("returns safe quota error %s", async (apiKey, status, error) => {
    const result = await OpenCodeGo.usage({
      storedApiKey: apiKey,
      fetch: async () => new Response("", { status: status ?? 200 }),
    })
    expect(result).toEqual({ ok: false, error })
  })

  test("rejects a configuration that changes the official endpoint or protocol", () => {
    expect(() => OpenCodeGo.assertConfiguration({ options: { baseURL: "https://example.com/v1" } })).toThrow()
    expect(() =>
      OpenCodeGo.assertConfiguration({
        options: { baseURL: OpenCodeGo.BASE_URL },
        models: { test: { protocol: "anthropic-messages" } },
      }),
    ).toThrow()
  })

  test("uses the explicit model protocol before a legacy provider protocol", () => {
    expect(() =>
      OpenCodeGo.assertConfiguration({
        options: { baseURL: OpenCodeGo.BASE_URL },
        models: {
          test: {
            protocol: "openai-chat",
            provider: { protocol: "anthropic-messages" },
          },
        },
      }),
    ).not.toThrow()
  })
})
