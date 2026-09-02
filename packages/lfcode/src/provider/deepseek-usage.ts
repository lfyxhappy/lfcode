import z from "zod"
import { numberValue, requestJSON, type Fetch, type UsageQueryResult } from "./quota"

export const PROVIDER_ID = "deepseek"
export const USAGE_URL = "https://api.deepseek.com/user/balance"

const Amount = z.union([z.number(), z.string().trim().min(1)]).refine((value) => numberValue(value) !== undefined)
const Response = z
  .object({
    is_available: z.boolean(),
    balance_infos: z
      .array(
        z
          .object({
            currency: z.string().trim().min(1),
            total_balance: Amount,
            granted_balance: Amount,
            topped_up_balance: Amount,
          })
          .strict(),
      )
      .min(1),
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
  const balance = parsed.data.balance_infos[0]
  const available = numberValue(balance.total_balance)
  const granted = numberValue(balance.granted_balance)
  const cash = numberValue(balance.topped_up_balance)
  if (available === undefined || granted === undefined || cash === undefined) return { ok: false, error: "invalid_response" }

  return {
    ok: true,
    usage: {
      balance: {
        available,
        total: available,
        granted,
        cash,
        currency: balance.currency,
        isAvailable: parsed.data.is_available,
      },
      windows: [],
    },
  }
}

export * as DeepSeekUsage from "./deepseek-usage"
