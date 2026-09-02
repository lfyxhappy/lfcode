import z from "zod"

export const TIMEOUT_MS = 15_000
export const MAX_BYTES = 512 * 1024

export const ErrorCategory = z.enum(["missing_api_key", "unauthorized", "rate_limited", "invalid_response", "network"])
export type ErrorCategory = z.infer<typeof ErrorCategory>

export const Balance = z.object({
  available: z.number().finite(),
  currency: z.string().trim().min(1),
  granted: z.number().finite().optional(),
  cash: z.number().finite().optional(),
  voucher: z.number().finite().optional(),
  isAvailable: z.boolean().optional(),
  total: z.number().finite().optional(),
})
export type Balance = z.infer<typeof Balance>

export const UsageWindow = z.object({
  id: z.string().trim().min(1),
  percent: z.number().finite().min(0).max(100).optional(),
  usedPercent: z.number().finite().min(0).max(100).optional(),
  remainingPercent: z.number().finite().min(0).max(100).optional(),
  resetsAt: z.string().datetime().optional(),
  resetInSeconds: z.number().finite().min(0).optional(),
  resetPeriod: z.string().trim().min(1).optional(),
  status: z.enum(["ok", "rate-limited"]).optional(),
  scope: z.enum(["account", "model"]).optional(),
  modelName: z.string().trim().min(1).optional(),
  remaining: z.number().finite().optional(),
  total: z.number().finite().positive().optional(),
  used: z.number().finite().optional(),
  currency: z.string().trim().min(1).optional(),
  unit: z.enum(["requests", "tokens", "unknown"]).optional(),
})
export type UsageWindow = z.infer<typeof UsageWindow>

export const Usage = z.object({
  balance: Balance.optional(),
  windows: z.array(UsageWindow),
  fetchedAt: z.string().datetime().optional(),
  source: z.string().trim().min(1).optional(),
})
export type Usage = z.infer<typeof Usage>

export const UsageQueryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), usage: Usage }),
  z.object({ ok: z.literal(false), error: ErrorCategory }),
])
export type UsageQueryResult = z.infer<typeof UsageQueryResult>

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function requestJSON(input: {
  url: string
  apiKey?: string
  signal?: AbortSignal
  fetch?: Fetch
}): Promise<{ ok: true; payload: unknown } | { ok: false; error: ErrorCategory }> {
  if (!input.apiKey?.trim()) return { ok: false, error: "missing_api_key" }

  try {
    const response = await (input.fetch ?? globalThis.fetch)(input.url, {
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, error: "unauthorized" }
    if (response.status === 429) return { ok: false, error: "rate_limited" }
    if (!response.ok) return { ok: false, error: "network" }

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return { ok: false, error: "invalid_response" }

    const payload = await response.json().catch(() => undefined)
    if (payload === undefined) return { ok: false, error: "invalid_response" }
    return { ok: true, payload }
  } catch {
    return { ok: false, error: "network" }
  }
}

export function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string" || !value.trim()) return
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export * as ProviderQuota from "./quota"
