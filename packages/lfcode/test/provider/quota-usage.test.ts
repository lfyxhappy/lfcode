import { describe, expect, test } from "bun:test"
import { DeepSeekUsage } from "@/provider/deepseek-usage"
import { MoonshotUsage } from "@/provider/moonshot-usage"
import { OpenRouterUsage } from "@/provider/openrouter-usage"
import type { Fetch } from "@/provider/quota"
import { SiliconFlowUsage } from "@/provider/siliconflow-usage"

describe("provider quota adapters", () => {
  test("reads DeepSeek native balances without returning its key", async () => {
    let url = ""
    let authorization = ""
    const result = await DeepSeekUsage.usage({
      storedApiKey: "deepseek-secret",
      fetch: async (input, init) => {
        url = String(input)
        authorization = new Headers(init?.headers).get("authorization") ?? ""
        return Response.json({
          is_available: true,
          balance_infos: [
            { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
          ],
        })
      },
    })

    expect(url).toBe(DeepSeekUsage.USAGE_URL)
    expect(authorization).toBe("Bearer deepseek-secret")
    expect(result).toEqual({
      ok: true,
      usage: {
        balance: { available: 110, total: 110, granted: 10, cash: 100, currency: "CNY", isAvailable: true },
        windows: [],
      },
    })
    expect(JSON.stringify(result)).not.toContain("deepseek-secret")
  })

  test.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "network"],
  ] as const)("maps DeepSeek HTTP %i to %s", async (status, error) => {
    const result = await DeepSeekUsage.usage({
      storedApiKey: "key",
      fetch: async () => new Response("", { status }),
    })
    expect(result).toEqual({ ok: false, error })
  })

  test("rejects DeepSeek malformed and non-JSON responses", async () => {
    const malformed = await DeepSeekUsage.usage({
      storedApiKey: "key",
      fetch: async () => Response.json({ is_available: true, balance_infos: [] }),
    })
    const invalidJSON = await DeepSeekUsage.usage({
      storedApiKey: "key",
      fetch: async () => new Response("not json"),
    })
    expect(malformed).toEqual({ ok: false, error: "invalid_response" })
    expect(invalidJSON).toEqual({ ok: false, error: "invalid_response" })
  })

  test("uses the configured Moonshot regional endpoint", async () => {
    const urls: string[] = []
    const fetch = async (input: string | URL | Request) => {
      urls.push(String(input))
      return Response.json({
        code: 0,
        data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
        scode: "0x0",
        status: true,
      })
    }
    const cn = await MoonshotUsage.usage({ storedApiKey: "cn-key", baseURL: "https://api.moonshot.cn/v1", fetch })
    const international = await MoonshotUsage.usage({ storedApiKey: "ai-key", baseURL: "https://api.moonshot.ai/v1", fetch })

    expect(urls).toEqual([MoonshotUsage.CHINA_USAGE_URL, MoonshotUsage.INTERNATIONAL_USAGE_URL])
    expect(cn).toMatchObject({ ok: true, usage: { balance: { currency: "CNY", available: 49.58894 } } })
    expect(international).toMatchObject({ ok: true, usage: { balance: { currency: "USD", voucher: 46.58893, cash: 3.00001 } } })
  })

  test("rejects unsuccessful Moonshot response data", async () => {
    const result = await MoonshotUsage.usage({
      storedApiKey: "key",
      fetch: async () => Response.json({ code: 0, data: {}, scode: "0x0", status: true }),
    })
    expect(result).toEqual({ ok: false, error: "invalid_response" })
  })

  test("reads the documented SiliconFlow balance fields", async () => {
    const result = await SiliconFlowUsage.usage({
      storedApiKey: "key",
      fetch: async () =>
        Response.json({
          status: true,
          message: "success",
          data: {
            id: "r0uqp80km0",
            name: "个人",
            email: "user@example.com",
            balance: "7.3972",
            chargeBalance: "15.2505",
            totalBalance: "22.6478",
            status: "active",
          },
        }),
    })

    expect(result).toEqual({
      ok: true,
      usage: {
        balance: { available: 22.6478, total: 22.6478, voucher: 7.3972, cash: 15.2505, currency: "CNY", isAvailable: true },
        windows: [],
      },
    })
  })

  test("fails safely when SiliconFlow changes its fixed response schema", async () => {
    const result = await SiliconFlowUsage.usage({
      storedApiKey: "key",
      fetch: async () => Response.json({ status: true, message: "success", data: { balance: "7.3972" } }),
    })
    expect(result).toEqual({ ok: false, error: "invalid_response" })
  })

  test("reads OpenRouter key limits without using management-only account credits", async () => {
    let url = ""
    const result = await OpenRouterUsage.usage({
      storedApiKey: "openrouter-secret",
      fetch: async (input) => {
        url = String(input)
        return Response.json({
          data: {
            label: "Default key",
            creator_user_id: "user_123",
            expires_at: "2030-01-01T00:00:00.000Z",
            limit: 25,
            limit_reset: "monthly",
            limit_remaining: 20,
            include_byok_in_limit: false,
            is_management_key: false,
            is_provisioning_key: false,
            rate_limit: { interval: "1h", note: "deprecated", requests: -1 },
            usage: 5,
            usage_daily: 1,
            usage_weekly: 2,
            usage_monthly: 5,
            byok_usage: 0,
            byok_usage_daily: 0,
            byok_usage_weekly: 0,
            byok_usage_monthly: 0,
            is_free_tier: false,
          },
        })
      },
    })

    expect(url).toBe(OpenRouterUsage.USAGE_URL)
    expect(result).toMatchObject({
      ok: true,
      usage: {
        windows: [
          { id: "key_limit", remaining: 20, total: 25, used: 5, usedPercent: 20, remainingPercent: 80, resetPeriod: "monthly", currency: "USD" },
          { id: "daily", used: 1, currency: "USD" },
          { id: "weekly", used: 2, currency: "USD" },
          { id: "monthly", used: 5, currency: "USD" },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain("openrouter-secret")
  })

  test("maps quota network failures without leaking provider credentials", async () => {
    const result = await OpenRouterUsage.usage({
      storedApiKey: "key",
      fetch: async () => {
        throw new Error("connection failed")
      },
    })
    expect(result).toEqual({ ok: false, error: "network" })
  })

  for (const [name, query] of [
    ["Moonshot", (fetch: Fetch) => MoonshotUsage.usage({ storedApiKey: "key", fetch })],
    ["SiliconFlow", (fetch: Fetch) => SiliconFlowUsage.usage({ storedApiKey: "key", fetch })],
    ["OpenRouter", (fetch: Fetch) => OpenRouterUsage.usage({ storedApiKey: "key", fetch })],
  ] as const) {
    test.each([
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "rate_limited"],
    ] as const)(`maps ${name} HTTP %i to %s`, async (status, error) => {
      const result = await query(async () => new Response("", { status }))
      expect(result).toEqual({ ok: false, error })
    })
  }

  test("does not request an upstream quota endpoint without a saved key", async () => {
    let called = false
    const result = await OpenRouterUsage.usage({
      fetch: async () => {
        called = true
        return Response.json({})
      },
    })
    expect(result).toEqual({ ok: false, error: "missing_api_key" })
    expect(called).toBeFalse()
  })
})
