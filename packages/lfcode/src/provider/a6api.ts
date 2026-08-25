import z from "zod"

export const A6API_BASE_URL = "https://a6api.com/v1"
export const A6API_MODELS_URL = `${A6API_BASE_URL}/models`
export const A6API_MODELS_TIMEOUT_MS = 15_000
export const A6API_MODELS_MAX_BYTES = 512 * 1024
export const A6API_PROVIDER_ID = "a6api"

export const Protocol = z.enum(["openai-chat", "openai-responses", "anthropic-messages"])
export type Protocol = z.infer<typeof Protocol>

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  protocol: Protocol,
})
export type Model = z.infer<typeof Model>

export const Source = z.enum(["temporary", "stored"])
export const ErrorCategory = z.enum(["missing_api_key", "unauthorized", "invalid_response", "network"])

export const DiscoverResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    source: Source,
    models: z.array(Model),
  }),
  z.object({
    ok: z.literal(false),
    models: z.array(Model).length(0),
    error: ErrorCategory,
  }),
])
export type DiscoverResult = z.infer<typeof DiscoverResult>

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function model(id: string): Model | undefined {
  const protocol = defaultProtocol(id)
  if (!protocol) return
  return {
    id,
    name: id,
    protocol,
  }
}

export function defaultProtocol(id: string): Protocol | undefined {
  const normalized = id.toLowerCase()
  if (normalized.startsWith("gpt-5.6")) return "openai-responses"
  if (normalized.startsWith("grok-4.6") || normalized.startsWith("deepseek")) return "openai-chat"
  if (normalized.startsWith("claude-5")) return "anthropic-messages"
}

export function assertConfiguration(input: {
  protocol?: string
  options?: { baseURL?: unknown }
  models?: Record<
    string,
    {
      id?: string
      protocol?: string
      provider?: { protocol?: string }
    }
  >
}) {
  if (input.options?.baseURL !== A6API_BASE_URL) {
    throw new Error("A6API configuration must use https://a6api.com/v1")
  }
  if (input.protocol && !Protocol.safeParse(input.protocol).success) {
    throw new Error("A6API configuration uses an unsupported provider protocol")
  }

  for (const [modelID, modelConfig] of Object.entries(input.models ?? {})) {
    const apiID = modelConfig.id ?? modelID
    if (!model(modelID) || !model(apiID)) {
      throw new Error("A6API configuration includes an unsupported model")
    }
    // Prefer the model's protocol so one provider can safely expose models
    // backed by different wire formats.
    const protocol = modelConfig.protocol ?? modelConfig.provider?.protocol ?? input.protocol
    if (!protocol || !Protocol.safeParse(protocol).success) {
      throw new Error("A6API configuration uses an unsupported model protocol")
    }
  }
}

export async function discover(input: {
  apiKey?: string
  storedApiKey?: string
  signal?: AbortSignal
  fetch?: Fetch
}): Promise<DiscoverResult> {
  const key = input.apiKey?.trim() || input.storedApiKey?.trim()
  if (!key) return { ok: false, models: [], error: "missing_api_key" }

  try {
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(A6API_MODELS_TIMEOUT_MS)])
      : AbortSignal.timeout(A6API_MODELS_TIMEOUT_MS)
    const response = await (input.fetch ?? globalThis.fetch)(A6API_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, models: [], error: "unauthorized" }
    }
    if (!response.ok) return { ok: false, models: [], error: "network" }

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > A6API_MODELS_MAX_BYTES) {
      return { ok: false, models: [], error: "invalid_response" }
    }
    const payload = await readJson(response)
      .catch(() => undefined)
    if (payload === undefined) return { ok: false, models: [], error: "invalid_response" }
    const parsed = z
      .object({
        data: z.array(z.object({ id: z.string().min(1), name: z.string().optional() })),
      })
      .safeParse(payload)
    if (!parsed.success) return { ok: false, models: [], error: "invalid_response" }

    const seen = new Set<string>()
    const models = parsed.data.data.flatMap((item) => {
      if (seen.has(item.id)) return []
      seen.add(item.id)
      const result = model(item.id)
      if (!result) return []
      return [{ ...result, name: item.name ?? result.name }]
    })
    return {
      ok: true,
      source: input.apiKey?.trim() ? "temporary" : "stored",
      models,
    }
  } catch {
    return { ok: false, models: [], error: "network" }
  }
}

async function readJson(response: Response) {
  if (!response.body) return JSON.parse("")

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > A6API_MODELS_MAX_BYTES) {
        await reader.cancel()
        throw new Error("A6API model catalog exceeds the safe limit")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export * as A6Api from "./a6api"
