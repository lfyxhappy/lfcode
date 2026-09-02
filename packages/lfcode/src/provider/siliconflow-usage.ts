import z from "zod"
import { numberValue, requestJSON, type Fetch, type UsageQueryResult } from "./quota"

export const PROVIDER_ID = "siliconflow"
export const USAGE_URL = "https://api.siliconflow.cn/v1/user/info"

const Amount = z.union([z.number(), z.string().trim().min(1)]).refine((value) => numberValue(value) !== undefined)
const Response = z
  .object({
    status: z.literal(true),
    message: z.string(),
    data: z
      .object({
        id: z.string().trim().min(1),
        name: z.string(),
        email: z.string(),
        balance: Amount,
        chargeBalance: Amount,
        totalBalance: Amount,
        status: z.string(),
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
  const voucher = numberValue(parsed.data.data.balance)
  const cash = numberValue(parsed.data.data.chargeBalance)
  const total = numberValue(parsed.data.data.totalBalance)
  if (voucher === undefined || cash === undefined || total === undefined) return { ok: false, error: "invalid_response" }

  return {
    ok: true,
    usage: {
      balance: {
        available: total,
        total,
        voucher,
        cash,
        currency: "CNY",
        isAvailable: parsed.data.data.status === "active",
      },
      windows: [],
    },
  }
}

export * as SiliconFlowUsage from "./siliconflow-usage"
