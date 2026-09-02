import z from "zod"
import { requestJSON, type Fetch, type UsageQueryResult } from "./quota"

export const PROVIDER_ID = "moonshotai"
export const INTERNATIONAL_USAGE_URL = "https://api.moonshot.ai/v1/users/me/balance"
export const CHINA_USAGE_URL = "https://api.moonshot.cn/v1/users/me/balance"

const Response = z
  .object({
    code: z.number().int(),
    data: z
      .object({
        available_balance: z.number().finite(),
        voucher_balance: z.number().finite(),
        cash_balance: z.number().finite(),
      })
      .strict(),
    scode: z.string(),
    status: z.boolean(),
  })
  .strict()

export function usageURL(baseURL?: string) {
  try {
    const host = new URL(baseURL ?? INTERNATIONAL_USAGE_URL).hostname.toLowerCase()
    if (host === "api.moonshot.cn" || host.endsWith(".moonshot.cn")) return CHINA_USAGE_URL
  } catch {}
  return INTERNATIONAL_USAGE_URL
}

export async function usage(input: {
  storedApiKey?: string
  baseURL?: string
  signal?: AbortSignal
  fetch?: Fetch
}): Promise<UsageQueryResult> {
  const url = usageURL(input.baseURL)
  const response = await requestJSON({ url, apiKey: input.storedApiKey, signal: input.signal, fetch: input.fetch })
  if (!response.ok) return response

  const parsed = Response.safeParse(response.payload)
  if (!parsed.success || parsed.data.code !== 0 || !parsed.data.status) return { ok: false, error: "invalid_response" }

  return {
    ok: true,
    usage: {
      balance: {
        available: parsed.data.data.available_balance,
        voucher: parsed.data.data.voucher_balance,
        cash: parsed.data.data.cash_balance,
        currency: url === CHINA_USAGE_URL ? "CNY" : "USD",
        isAvailable: parsed.data.data.available_balance > 0,
      },
      windows: [],
    },
  }
}

export * as MoonshotUsage from "./moonshot-usage"
