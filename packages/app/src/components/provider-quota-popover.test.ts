import { describe, expect, test } from "bun:test"
import { QUOTA_CACHE_TTL_MS, quotaAuthProviderID, quotaBalanceFields, quotaProviderDocsURL, quotaRefreshResult, shouldRefreshQuota, supportedQuotaProviderIDs, supportsQuotaQuery, visibleQuotaWindows } from "./provider-quota-capability"

describe("provider quota capability registry", () => {
  test("only exposes connected providers with registered quota support", () => {
    expect(supportedQuotaProviderIDs([{ id: "openai" }, { id: "opencode-go" }, { id: "minimax" }, { id: "minimax-cn-coding-plan" }, { id: "deepseek" }, { id: "moonshotai" }, { id: "siliconflow" }, { id: "openrouter" }, { id: "a6api" }])).toEqual(["opencode-go", "minimax", "minimax-cn-coding-plan", "deepseek", "moonshotai", "siliconflow", "openrouter"])
  })

  test("reuses the canonical auth entry for provider aliases", () => {
    expect(quotaAuthProviderID("minimax-cn-coding-plan")).toBe("minimax")
    expect(quotaAuthProviderID("opencode-go")).toBe("opencode-go")
  })

  test("registers the four API-backed providers and keeps unsupported providers on their official documentation", () => {
    expect(supportsQuotaQuery("deepseek")).toBe(true)
    expect(supportsQuotaQuery("moonshotai")).toBe(true)
    expect(supportsQuotaQuery("siliconflow")).toBe(true)
    expect(supportsQuotaQuery("openrouter")).toBe(true)
    expect(supportsQuotaQuery("openai")).toBe(false)
    expect(quotaProviderDocsURL("openai")).toBe("https://platform.openai.com/usage")
  })
})

describe("provider quota presentation", () => {
  test("uses a 30 second cache unless the user manually refreshes", () => {
    const cachedAt = 1_000
    expect(shouldRefreshQuota({ cachedAt, now: cachedAt + QUOTA_CACHE_TTL_MS - 1 })).toBe(false)
    expect(shouldRefreshQuota({ cachedAt, now: cachedAt + QUOTA_CACHE_TTL_MS })).toBe(true)
    expect(shouldRefreshQuota({ cachedAt, now: cachedAt + 1, force: true })).toBe(true)
  })

  test("retains the last successful quota result after a refresh error", () => {
    const cached = { ok: true as const, usage: { fetchedAt: "2026-08-30T00:00:00.000Z", windows: [] } }
    expect(quotaRefreshResult({ cached, next: { ok: false, error: "network" } })).toEqual({ result: cached, refreshError: "network" })
  })

  test("keeps provider-native balance fields and filters hidden video windows", () => {
    expect(quotaBalanceFields({ available: 18.5, granted: 2, cash: 10, voucher: 6.5, currency: "CNY" })).toEqual([
      { id: "available", value: 18.5 },
      { id: "granted", value: 2 },
      { id: "cash", value: 10 },
      { id: "voucher", value: 6.5 },
    ])
    expect(visibleQuotaWindows([{ id: "daily", used: 10 }, { id: "video:monthly", used: 2 }, { id: "monthly", modelName: "video", used: 2 }])).toEqual([{ id: "daily", used: 10 }])
  })
})
