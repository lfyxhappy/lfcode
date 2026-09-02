import type { Info as ProviderInfo, Model as ProviderModel } from "./provider"
import { A6API_PROVIDER_ID, discover as discoverA6Api } from "./a6api"
import { LfApi } from "./lfapi"
import { OpenCodeGo } from "./opencode-go"
import { OpenCode } from "./opencode"

export const DISCOVERY_TIMEOUT_MS = 15_000
export const DISCOVERY_MAX_BYTES = 512 * 1024
export const DISCOVERY_MAX_MODELS = 500

export type DiscoveryError =
  | "unsupported"
  | "missing_credentials"
  | "unauthorized"
  | "invalid_response"
  | "network"
  | "unsafe_url"
export type DiscoveredModel = { id: string; name?: string; protocol?: string }
export type DiscoveryResult = {
  source: "remote" | "specialized"
  models: DiscoveredModel[]
  warning?: string
  error?: DiscoveryError
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function discoverProviderModels(
  provider: ProviderInfo,
  input: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<DiscoveryResult> {
  const specialized = await discoverSpecialized(provider.id, provider.key, input.signal)
  if (specialized) return specialized

  const baseURL = resolveBaseURL(provider)
  if (!baseURL) return { source: "remote", models: [], error: "unsupported" }

  let url: URL
  try {
    url = new URL(`${baseURL.replace(/\/+$/, "")}/models`)
  } catch {
    return { source: "remote", models: [], error: "unsafe_url" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { source: "remote", models: [], error: "unsafe_url" }
  }

  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)])
    : AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
  try {
    const headers = provider.key ? { Authorization: `Bearer ${provider.key}` } : undefined
    const response = await (input.fetch ?? globalThis.fetch)(url, { headers, signal })
    if (response.status === 401 || response.status === 403)
      return { source: "remote", models: [], error: "unauthorized" }
    if (!response.ok) return { source: "remote", models: [], error: "network" }
    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > DISCOVERY_MAX_BYTES)
      return { source: "remote", models: [], error: "invalid_response" }
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > DISCOVERY_MAX_BYTES)
      return { source: "remote", models: [], error: "invalid_response" }
    const parsed = JSON.parse(body) as unknown
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
          ? (parsed as { models: unknown[] }).models
          : undefined
    if (!rows) return { source: "remote", models: [], error: "invalid_response" }
    const seen = new Set<string>()
    const models = rows.flatMap((row): DiscoveredModel[] => {
      if (!row || typeof row !== "object") return []
      const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id.trim() : ""
      if (!id || seen.has(id) || seen.size >= DISCOVERY_MAX_MODELS) return []
      seen.add(id)
      const name = typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : undefined
      const protocol =
        typeof (row as { protocol?: unknown }).protocol === "string"
          ? (row as { protocol: string }).protocol.trim() || undefined
          : undefined
      return [{ id, name, protocol }]
    })
    return { source: "remote", models }
  } catch (error) {
    if (error instanceof SyntaxError) return { source: "remote", models: [], error: "invalid_response" }
    return { source: "remote", models: [], error: "network" }
  }
}

function resolveBaseURL(provider: ProviderInfo) {
  const configured = provider.options?.baseURL
  if (typeof configured === "string" && configured.trim()) return configured.trim()
  const model = Object.values(provider.models)[0] as ProviderModel | undefined
  return model?.api?.url
}

async function discoverSpecialized(
  providerID: string,
  key: string | undefined,
  signal?: AbortSignal,
): Promise<DiscoveryResult | undefined> {
  if (providerID === A6API_PROVIDER_ID) {
    const result = await discoverA6Api({ storedApiKey: key, signal })
    return result.ok
      ? { source: "specialized", models: result.models }
      : { source: "specialized", models: [], error: mapDiscoveryError(result.error) }
  }
  if (providerID === LfApi.PROVIDER_ID) {
    const result = await LfApi.discover({ storedApiKey: key, signal })
    return result.ok
      ? { source: "specialized", models: result.models }
      : { source: "specialized", models: [], error: mapDiscoveryError(result.error) }
  }
  if (providerID === OpenCode.PROVIDER_ID) {
    const result = await OpenCode.discover({ storedApiKey: key, signal })
    return result.ok
      ? { source: "specialized", models: result.models }
      : { source: "specialized", models: [], error: mapDiscoveryError(result.error) }
  }
  if (providerID === OpenCodeGo.PROVIDER_ID) {
    const result = await OpenCodeGo.discover({ storedApiKey: key, signal })
    return result.ok
      ? { source: "specialized", models: result.models }
      : { source: "specialized", models: [], error: mapDiscoveryError(result.error) }
  }
  return undefined
}

function mapDiscoveryError(error: "missing_api_key" | "unauthorized" | "invalid_response" | "network"): DiscoveryError {
  return error === "missing_api_key" ? "missing_credentials" : error
}
