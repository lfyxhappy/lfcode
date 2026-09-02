import z from "zod"

export const BASE_URL = "https://ai.liangfeng.net.cn/v1"
export const MODELS_URL = `${BASE_URL}/models`
export const PROVIDER_ID = "lfapi"
export const MODELS_TIMEOUT_MS = 15_000
export const MAX_BYTES = 512 * 1024

export const Protocol = z.enum(["openai-chat", "openai-responses"])
export type Protocol = z.infer<typeof Protocol>

export const Model = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  protocol: Protocol,
})
export type Model = z.infer<typeof Model>

export const Source = z.enum(["temporary", "stored"])
export const ErrorCategory = z.enum(["missing_api_key", "unauthorized", "invalid_response", "network"])
export const DiscoverResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), source: Source, models: z.array(Model) }),
  z.object({ ok: z.literal(false), models: z.array(Model).length(0), error: ErrorCategory }),
])
export type DiscoverResult = z.infer<typeof DiscoverResult>

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

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
      ? AbortSignal.any([input.signal, AbortSignal.timeout(MODELS_TIMEOUT_MS)])
      : AbortSignal.timeout(MODELS_TIMEOUT_MS)
    const response = await (input.fetch ?? globalThis.fetch)(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    })
    if (response.status === 401 || response.status === 403) return { ok: false, models: [], error: "unauthorized" }
    if (!response.ok) return { ok: false, models: [], error: "network" }

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return { ok: false, models: [], error: "invalid_response" }
    const payload = await readJson(response).catch(() => undefined)
    if (payload === undefined) return { ok: false, models: [], error: "invalid_response" }
    const parsed = z
      .object({ data: z.array(z.object({ id: z.string().min(1), name: z.string().optional() })) })
      .safeParse(payload)
    if (!parsed.success) return { ok: false, models: [], error: "invalid_response" }

    const seen = new Set<string>()
    const models = parsed.data.data.flatMap((item) => {
      const id = item.id.trim()
      if (!id || seen.has(id)) return []
      seen.add(id)
      return [{ id, name: item.name?.trim() || id, protocol: "openai-chat" as const }]
    })
    return { ok: true, source: input.apiKey?.trim() ? "temporary" : "stored", models }
  } catch {
    return { ok: false, models: [], error: "network" }
  }
}

async function readJson(response: Response) {
  if (!response.body) return JSON.parse(await response.text())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_BYTES) {
        await reader.cancel()
        throw new Error("LFAPI model catalog exceeds the safe limit")
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

export function assertConfiguration(input: {
  protocol?: string
  options?: { baseURL?: unknown }
  models?: Record<string, { id?: string; protocol?: string; provider?: { protocol?: string } }>
}) {
  if (input.options?.baseURL !== BASE_URL) throw new Error(`LFAPI configuration must use ${BASE_URL}`)
  if (input.protocol && !Protocol.safeParse(input.protocol).success)
    throw new Error("LFAPI configuration uses an unsupported provider protocol")
  for (const [modelID, model] of Object.entries(input.models ?? {})) {
    const protocol = model.protocol ?? model.provider?.protocol ?? input.protocol
    if (!protocol || !Protocol.safeParse(protocol).success)
      throw new Error(`LFAPI model ${modelID} uses an unsupported protocol`)
  }
}

export * as LfApi from "./lfapi"
