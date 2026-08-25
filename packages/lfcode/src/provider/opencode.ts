import z from "zod"
import {
  OPENCODE_BASE_URL,
  OPENCODE_CONTEXT_LIMIT,
  OPENCODE_MODELS_URL,
  OPENCODE_OUTPUT_LIMIT,
  OPENCODE_PROVIDER_ID,
  OPENCODE_USAGE_URL,
} from "@lfcode-ai/shared/opencode"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"

export const BASE_URL = OPENCODE_BASE_URL
export const MODELS_URL = OPENCODE_MODELS_URL
export const USAGE_URL = OPENCODE_USAGE_URL
export const PROVIDER_ID = OPENCODE_PROVIDER_ID
export const MODELS_TIMEOUT_MS = 15_000
export const Protocol = z.literal("openai-chat")
export const Model = z.object({
  id: z.string(),
  name: z.string(),
  protocol: Protocol,
  reasoning_options: z
    .array(z.object({ type: z.string(), values: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional() }))
    .optional(),
  capabilities: z
    .object({ reasoning: z.boolean(), temperature: z.boolean(), tool_call: z.boolean() })
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
    const payload = await response.json().catch(() => undefined)
    const parsed = z
      .object({
        data: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().optional(),
            capabilities: Model.shape.capabilities,
          }),
        ),
      })
      .safeParse(payload)
    if (!parsed.success) return { ok: false, models: [], error: "invalid_response" }
    const seen = new Set<string>()
    return {
      ok: true,
      source: input.apiKey?.trim() ? "temporary" : "stored",
      models: parsed.data.data.flatMap((item) =>
        seen.has(item.id)
          ? []
          : (seen.add(item.id), [model(item.id, item.name)]),
      ),
    }
  } catch {
    return { ok: false, models: [], error: "network" }
  }
}

export async function usage(input: { storedApiKey?: string; signal?: AbortSignal; fetch?: Fetch }): Promise<UsageQueryResult> {
  const key = input.storedApiKey?.trim()
  if (!key) return { ok: false, error: "missing_api_key" }
  try {
    const response = await (input.fetch ?? globalThis.fetch)(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(MODELS_TIMEOUT_MS)]) : AbortSignal.timeout(MODELS_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, error: response.status === 401 || response.status === 403 ? "unauthorized" : "invalid_response" }
    const parsed = UsageResult.safeParse(await response.json())
    if (!parsed.success) return { ok: false, error: "invalid_response" }
    return { ok: true, usage: parsed.data.usage }
  } catch {
    return { ok: false, error: "network" }
  }
}

export function assertConfiguration(input: {
  options?: { baseURL?: unknown }
  models?: Record<string, { id?: string; protocol?: string; provider?: { protocol?: string } }>
}) {
  if (input.options?.baseURL !== BASE_URL) throw new Error(`OpenCode configuration must use ${BASE_URL}`)
  for (const [id, config] of Object.entries(input.models ?? {})) {
    if (config.id && config.id !== id) throw new Error("OpenCode configuration includes an unsupported model alias")
    if ((config.protocol ?? config.provider?.protocol ?? "openai-chat") !== "openai-chat")
      throw new Error("OpenCode uses the OpenAI Chat Completions protocol")
  }
}

export { OPENCODE_CONTEXT_LIMIT, OPENCODE_OUTPUT_LIMIT }
export * as OpenCode from "./opencode"
