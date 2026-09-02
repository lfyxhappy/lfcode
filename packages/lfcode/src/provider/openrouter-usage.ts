import z from "zod"
import { requestJSON, type Fetch, type UsageQueryResult, type UsageWindow } from "./quota"

export const PROVIDER_ID = "openrouter"
export const USAGE_URL = "https://openrouter.ai/api/v1/key"

const NullableNumber = z.number().finite().nullable()
const RateLimit = z
  .object({
    interval: z.string(),
    note: z.string(),
    requests: z.number().finite(),
  })
  .strict()
const Response = z
  .object({
    data: z
      .object({
        label: z.string(),
        creator_user_id: z.string().nullable(),
        expires_at: z.string().datetime().nullable(),
        limit: NullableNumber,
        limit_reset: z.string().nullable(),
        limit_remaining: NullableNumber,
        include_byok_in_limit: z.boolean(),
        is_management_key: z.boolean(),
        is_provisioning_key: z.boolean(),
        rate_limit: RateLimit,
        usage: z.number().finite(),
        usage_daily: z.number().finite(),
        usage_weekly: z.number().finite(),
        usage_monthly: z.number().finite(),
        byok_usage: z.number().finite(),
        byok_usage_daily: z.number().finite(),
        byok_usage_weekly: z.number().finite(),
        byok_usage_monthly: z.number().finite(),
        is_free_tier: z.boolean(),
      })
      .strict(),
  })
  .strict()

export async function usage(input: {
  storedApiKey?: string
  signal?: AbortSignal
  fetch?: Fetch
}): Promise<UsageQueryResult> {
  const response = await requestJSON({
    url: USAGE_URL,
    apiKey: input.storedApiKey,
    signal: input.signal,
    fetch: input.fetch,
  })
  if (!response.ok) return response

  const parsed = Response.safeParse(response.payload)
  if (!parsed.success) return { ok: false, error: "invalid_response" }
  const data = parsed.data.data
  const limit = data.limit
  const remaining = data.limit_remaining
  const used = limit !== null && remaining !== null ? limit - remaining : undefined
  const percent = used !== undefined && limit !== null && limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : undefined
  const reset = data.limit_reset === null || Number.isNaN(Date.parse(data.limit_reset)) ? undefined : new Date(data.limit_reset).toISOString()
  const resetPeriod = data.limit_reset?.trim() || "key"
  const windows: UsageWindow[] = [
    ...(limit !== null && remaining !== null
      ? [
          {
            id: "key_limit",
            remaining,
            total: limit,
            ...(used === undefined ? {} : { used }),
            ...(percent === undefined ? {} : { percent, usedPercent: percent, remainingPercent: 100 - percent }),
            ...(reset === undefined ? {} : { resetsAt: reset }),
            resetPeriod,
            currency: "USD",
            unit: "unknown" as const,
            scope: "account" as const,
            status: remaining <= 0 ? "rate-limited" as const : "ok" as const,
          },
        ]
      : []),
    { id: "daily", used: data.usage_daily, resetPeriod: "daily", currency: "USD", unit: "unknown" },
    { id: "weekly", used: data.usage_weekly, resetPeriod: "weekly", currency: "USD", unit: "unknown" },
    { id: "monthly", used: data.usage_monthly, resetPeriod: "monthly", currency: "USD", unit: "unknown" },
  ]

  return { ok: true, usage: { windows } }
}

export * as OpenRouterUsage from "./openrouter-usage"
