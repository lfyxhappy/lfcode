import z from "zod"
import { MINIMAX_PROVIDER_ID } from "./minimax"

const TIMEOUT_MS = 15_000
const MAX_BYTES = 512 * 1024

export const ErrorCategory = z.enum(["missing_api_key", "unauthorized", "rate_limited", "invalid_response", "network"])
export const UsageWindow = z.object({
  // MiniMax can return one entry per model (for example `general` and
  // `video`). Keep the id open so new model names do not get silently lost.
  id: z.string().min(1),
  percent: z.number().finite().min(0).max(100),
  // `percent` is the consumed percentage for compatibility with OpenCode Go.
  // MiniMax reports the inverse (remaining percentage), so expose both values
  // when the upstream response makes them available or allows them to be
  // derived from absolute limits.
  usedPercent: z.number().finite().min(0).max(100).optional(),
  remainingPercent: z.number().finite().min(0).max(100).optional(),
  resetsAt: z.string(),
  resetInSeconds: z.number().finite().min(0).optional(),
  status: z.enum(["ok", "rate-limited"]).optional(),
  scope: z.enum(["account", "model"]).optional(),
  modelName: z.string().min(1).optional(),
  remaining: z.number().finite().min(0).optional(),
  total: z.number().finite().positive().optional(),
  used: z.number().finite().min(0).optional(),
  unit: z.enum(["requests", "tokens", "unknown"]).optional(),
})
export const UsageQueryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), usage: z.object({ windows: z.array(UsageWindow).min(1) }) }),
  z.object({ ok: z.literal(false), error: ErrorCategory }),
])
export type UsageQueryResult = z.infer<typeof UsageQueryResult>

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function usage(input: { apiKey?: string; storedApiKey?: string; signal?: AbortSignal; fetch?: Fetch }): Promise<UsageQueryResult> {
  const key = input.apiKey?.trim() || input.storedApiKey?.trim()
  if (!key) return { ok: false, error: "missing_api_key" }

  try {
    const response = await (input.fetch ?? globalThis.fetch)("https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains", {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, error: "unauthorized" }
    if (response.status === 429) return { ok: false, error: "rate_limited" }
    if (!response.ok) return { ok: false, error: "network" }
    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return { ok: false, error: "invalid_response" }
    const payload = await response.json().catch(() => undefined)
    const windows = parseUsage(payload)
    return windows ? { ok: true, usage: { windows } } : { ok: false, error: "invalid_response" }
  } catch {
    return { ok: false, error: "network" }
  }
}

export function parseUsage(input: unknown) {
  const payload = z
    .object({
      base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).optional(),
      model_remains: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .safeParse(input)
  if (!payload.success || (payload.data.base_resp && payload.data.base_resp.status_code !== 0)) return
  const windows = (payload.data.model_remains ?? []).flatMap((item) => {
    const modelName = typeof item.model_name === "string" && item.model_name.trim() ? item.model_name.trim() : undefined
    if (!modelName) return []
    const scope = modelName === "general" ? "account" : "model"
    const prefix = modelName === "general" ? "" : `${modelName}:`
    const interval = toWindow(
      `${prefix}five_hour`,
      firstNumber(item.current_interval_remaining_percent, item.current_interval_remains_percent, item.current_interval_remaining_rate),
      firstTimestamp(item.end_time, item.current_interval_end_time, item.current_interval_reset_at),
      firstNumber(item.remains_time, item.current_interval_remains_time, item.current_interval_reset_in),
      {
        scope,
        modelName,
        // The upstream `current_interval_usage_count` field is actually the
        // remaining count. Keep it as remaining; do not label it as used.
        remaining: firstNumber(item.current_interval_remaining, item.current_interval_remaining_count, item.current_interval_usage_count, item.current_interval_remaining_tokens),
        total: firstPositiveNumber(item.current_interval_total, item.current_interval_total_count, item.current_interval_total_tokens, item.current_interval_limit),
        used: firstNumber(item.current_interval_used, item.current_interval_usage, item.current_interval_consumed, item.current_interval_used_tokens),
        ...(item.current_interval_total_count !== undefined
          ? { unit: "requests" as const }
          : item.current_interval_total_tokens !== undefined
            ? { unit: "tokens" as const }
            : {}),
      },
    )
    const weekly = hasAny(
      item.current_weekly_remaining_percent,
      item.current_weekly_remains_percent,
      item.current_weekly_remaining,
      item.current_weekly_remaining_count,
      item.current_weekly_usage_count,
      item.current_weekly_remaining_tokens,
      item.current_weekly_total,
      item.current_weekly_total_count,
      item.current_weekly_total_tokens,
      item.current_weekly_limit,
    )
      ? toWindow(
          `${prefix}weekly`,
          firstNumber(item.current_weekly_remaining_percent, item.current_weekly_remains_percent, item.current_weekly_remaining_rate),
          firstTimestamp(item.weekly_end_time, item.current_weekly_end_time, item.current_weekly_reset_at),
          firstNumber(item.weekly_remains_time, item.current_weekly_remains_time, item.current_weekly_reset_in),
          {
            scope,
            modelName,
            remaining: firstNumber(item.current_weekly_remaining, item.current_weekly_remaining_count, item.current_weekly_usage_count, item.current_weekly_remaining_tokens),
            total: firstPositiveNumber(item.current_weekly_total, item.current_weekly_total_count, item.current_weekly_total_tokens, item.current_weekly_limit),
            used: firstNumber(item.current_weekly_used, item.current_weekly_usage, item.current_weekly_consumed, item.current_weekly_used_tokens),
            ...(item.current_weekly_total_count !== undefined
              ? { unit: "requests" as const }
              : item.current_weekly_total_tokens !== undefined
                ? { unit: "tokens" as const }
                : {}),
          },
        )
      : undefined
    return [interval, weekly].filter((value): value is z.infer<typeof UsageWindow> => value !== undefined)
  })
  return windows.length ? windows : undefined
}

function firstNumber(...values: unknown[]) {
  return values.map(toNumber).find((value): value is number => value !== undefined && value >= 0)
}

function hasAny(...values: unknown[]) {
  return values.some((value) => toNumber(value) !== undefined)
}

function firstTimestamp(...values: unknown[]) {
  return values.map((value) => {
    const numeric = toNumber(value)
    if (numeric !== undefined) return numeric
    if (typeof value !== "string" || !value.trim()) return
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }).find((value): value is number => value !== undefined && value > 0)
}

function firstPositiveNumber(...values: unknown[]) {
  return values.map(toNumber).find((value): value is number => value !== undefined && value > 0)
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string" || !value.trim()) return
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toWindow(
  id: z.infer<typeof UsageWindow>["id"],
  remainingPercent: unknown,
  endTime: unknown,
  remainsTime: unknown,
  details: Pick<z.infer<typeof UsageWindow>, "scope" | "modelName" | "remaining" | "total" | "used" | "unit">,
): z.infer<typeof UsageWindow> | undefined {
  const remaining = toNumber(remainingPercent)
  const absoluteRemaining = details.remaining
  const absoluteTotal = details.total
  const absoluteUsed = details.used
  const derivedRemaining = remaining ?? (absoluteRemaining !== undefined && absoluteTotal !== undefined && absoluteTotal > 0
    ? (absoluteRemaining / absoluteTotal) * 100
    : absoluteUsed !== undefined && absoluteTotal !== undefined && absoluteTotal > 0
      ? ((absoluteTotal - absoluteUsed) / absoluteTotal) * 100
      : undefined)
  const timestamp = toNumber(endTime)
  const validTimestamp = timestamp !== undefined && timestamp > 0 ? timestamp : undefined
  const duration = normalizeDuration(remainsTime, validTimestamp)
  if (derivedRemaining === undefined || (validTimestamp === undefined && duration === undefined)) return
  const reset = validTimestamp === undefined
    ? new Date(Date.now() + duration! * 1000)
    : new Date(validTimestamp < 1_000_000_000_000 ? validTimestamp * 1000 : validTimestamp)
  if (Number.isNaN(reset.getTime())) return
  const computedRemainingPercent = Math.max(0, Math.min(100, derivedRemaining))
  const percent = 100 - computedRemainingPercent
  return {
    id,
    percent,
    usedPercent: percent,
    remainingPercent: computedRemainingPercent,
    resetsAt: reset.toISOString(),
    ...(duration !== undefined ? { resetInSeconds: duration } : {}),
    status: (percent >= 100 ? "rate-limited" : "ok") as "ok" | "rate-limited",
    ...details,
    ...(details.remaining !== undefined && details.total !== undefined && details.used === undefined && details.total >= details.remaining
      ? { used: details.total - details.remaining }
      : {}),
  }
}

function normalizeDuration(value: unknown, endTime: number | undefined) {
  const duration = toNumber(value)
  if (duration === undefined) return

  // MiniMax has returned these fields in both seconds and milliseconds. When
  // an absolute reset is available, use it to identify a unit mismatch; for
  // duration-only responses, values above one week are unambiguously ms for
  // the five-hour/weekly coding-plan windows.
  if (endTime !== undefined) {
    const resetAt = endTime < 1_000_000_000_000 ? endTime * 1000 : endTime
    const expected = Math.max(0, (resetAt - Date.now()) / 1000)
    if (expected > 0 && duration > expected * 100) {
      const milliseconds = duration / 1000
      if (Math.abs(milliseconds - expected) <= Math.max(300, expected * 0.2)) return milliseconds
    }
  }
  return duration > 7 * 24 * 60 * 60 ? duration / 1000 : duration
}

export { MINIMAX_PROVIDER_ID }
export * as MiniMaxUsage from "./minimax-usage"
