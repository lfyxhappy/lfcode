import z from "zod"
import {
  OPENCODE_GO_BASE_URL,
  OPENCODE_GO_CONTEXT_LIMIT,
  OPENCODE_GO_MODELS_URL,
  OPENCODE_GO_OUTPUT_LIMIT,
  OPENCODE_GO_PROVIDER_ID,
  OPENCODE_GO_USAGE_URL,
} from "@lfcode-ai/shared/opencode-go"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"

export const BASE_URL = OPENCODE_GO_BASE_URL
export const MODELS_URL = OPENCODE_GO_MODELS_URL
export const USAGE_URL = OPENCODE_GO_USAGE_URL
export const PROVIDER_ID = OPENCODE_GO_PROVIDER_ID
export const MODELS_TIMEOUT_MS = 15_000
export const MAX_BYTES = 512 * 1024
export const Protocol = z.literal("openai-chat")
export const Model = z.object({
  id: z.string(),
  name: z.string(),
  protocol: Protocol,
  reasoning_options: z
    .array(z.object({ type: z.string(), values: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional() }))
    .optional(),
  capabilities: z
    .object({
      reasoning: z.boolean().optional(),
      temperature: z.boolean().optional(),
      tool_call: z.boolean().optional(),
    })
    .optional(),
})
export type Model = z.infer<typeof Model>
export const Source = z.enum(["temporary", "stored"])
export const ErrorCategory = z.enum(["missing_api_key", "unauthorized", "invalid_response", "network"])
export const DiscoverResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), source: Source, models: z.array(Model) }),
  z.object({ ok: z.literal(false), models: z.array(Model).length(0), error: ErrorCategory }),
])
export type DiscoverResult = z.infer<typeof DiscoverResult>

export const UsageWindow = z.object({
  status: z.enum(["ok", "rate-limited"]),
  percent: z.number().finite().min(0),
  usedPercent: z.number().finite().min(0).max(100).optional(),
  remainingPercent: z.number().finite().min(0).max(100).optional(),
  resetsAt: z.string(),
  resetInSeconds: z.number().finite().min(0).optional(),
  remaining: z.number().finite().min(0).optional(),
  total: z.number().finite().positive().optional(),
  used: z.number().finite().min(0).optional(),
  unit: z.enum(["requests", "tokens", "unknown"]).optional(),
})
export const UsageResult = z.object({ usage: z.object({ rolling: UsageWindow, weekly: UsageWindow, monthly: UsageWindow }) })
export type UsageResult = z.infer<typeof UsageResult>
export const UsageQueryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), usage: UsageResult.shape.usage }),
  z.object({ ok: z.literal(false), error: ErrorCategory }),
])
export type UsageQueryResult = z.infer<typeof UsageQueryResult>

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function model(id: string, name = id): Model {
  const profile = inferModelProfile({ modelID: id, apiID: name })
  return {
    id,
    name,
    protocol: "openai-chat",
    ...(profile.reasoningModes.length ? { reasoning_options: profile.reasoningModes } : {}),
    capabilities: {
      reasoning: profile.capabilities.reasoning,
      temperature: profile.capabilities.temperature,
      tool_call: profile.capabilities.tool_call,
    },
  }
}

export async function discover(input: { apiKey?: string; storedApiKey?: string; signal?: AbortSignal; fetch?: Fetch }): Promise<DiscoverResult> {
  const key = input.apiKey?.trim() || input.storedApiKey?.trim()
  try {
    const response = await (input.fetch ?? globalThis.fetch)(MODELS_URL, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(MODELS_TIMEOUT_MS)]) : AbortSignal.timeout(MODELS_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, models: [], error: response.status === 401 || response.status === 403 ? "unauthorized" : "network" }
    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return { ok: false, models: [], error: "invalid_response" }
    const payload = await response.json().catch(() => undefined)
    const parsed = z
      .object({
        data: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().optional(),
            capabilities: Model.shape.capabilities.optional(),
          }),
        ),
      })
      .safeParse(payload)
    if (!parsed.success) return { ok: false, models: [], error: "invalid_response" }
    const seen = new Set<string>()
    return {
      ok: true,
      source: input.apiKey?.trim() ? "temporary" : "stored",
      models: parsed.data.data.flatMap((item) => {
        if (seen.has(item.id)) return []
        seen.add(item.id)
        return [model(item.id, item.name)]
      }),
    }
  } catch {
    return { ok: false, models: [], error: "network" }
  }
}

export async function usage(input: {
  apiKey?: string
  storedApiKey?: string
  signal?: AbortSignal
  fetch?: Fetch
}): Promise<UsageQueryResult> {
  const key = input.apiKey?.trim() || input.storedApiKey?.trim()
  if (!key) return { ok: false, error: "missing_api_key" }
  try {
    const response = await (input.fetch ?? globalThis.fetch)(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(MODELS_TIMEOUT_MS)]) : AbortSignal.timeout(MODELS_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, error: response.status === 401 || response.status === 403 ? "unauthorized" : "network" }
    const parsed = UsageResult.safeParse(await response.json())
    if (!parsed.success) return { ok: false, error: "invalid_response" }
    const usage = Object.fromEntries(Object.entries(parsed.data.usage).map(([id, window]) => [id, {
      ...window,
      usedPercent: window.usedPercent ?? window.percent,
      remainingPercent: window.remainingPercent ?? Math.max(0, 100 - window.percent),
    }])) as UsageResult["usage"]
    return { ok: true, usage }
  } catch {
    return { ok: false, error: "network" }
  }
}

export function assertConfiguration(input: { options?: { baseURL?: unknown }; models?: Record<string, { id?: string; protocol?: string; provider?: { protocol?: string } }> }) {
  if (input.options?.baseURL !== BASE_URL) throw new Error(`OpenCode Go configuration must use ${BASE_URL}`)
  for (const [id, config] of Object.entries(input.models ?? {})) {
    if (config.id && config.id !== id) throw new Error("OpenCode Go configuration includes an unsupported model alias")
    // Protocol is a model-level setting. A legacy provider-level protocol may
    // still be present, but it must not override the model's explicit format.
    if ((config.protocol ?? config.provider?.protocol ?? "openai-chat") !== "openai-chat") throw new Error("OpenCode Go uses the OpenAI Chat Completions protocol")
  }
}

export { OPENCODE_GO_CONTEXT_LIMIT, OPENCODE_GO_OUTPUT_LIMIT }
export * as OpenCodeGo from "./opencode-go"
