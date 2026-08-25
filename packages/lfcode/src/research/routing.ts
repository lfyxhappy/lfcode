import {
  normalizeWebSearchQuery,
  sanitizeWebSearchUrl,
  type SearchResultEnvelope,
  type WebSearchProvider,
  type WebSearchRoute,
} from "@lfcode-ai/shared/web-search"
import { validateBrowserSearchSettings, type BrowserSearchEngine } from "./schema"

export type { BrowserSearchEngine } from "./schema"

export type BrowserSearchConfig = {
  engine: BrowserSearchEngine
  /** Required for custom engines; `{query}` is replaced with encoded input. */
  template?: string
}

export type SearchRouteInput = {
  query: string
  url?: string
  route?: WebSearchRoute
  nativeAvailable?: boolean
  nativeResult?: Pick<SearchResultEnvelope, "sources" | "warnings"> & { status?: string }
  browser?: BrowserSearchConfig
  compatProvider?: WebSearchProvider
  hasRegisteredDirectSource?: boolean
  registeredDirectURL?: string
  cachedURL?: string
}

export type SearchRouteDecision = {
  route: WebSearchRoute
  queryOriginal: string
  queryPlanned: string
  querySent: string
  queryFidelity: SearchResultEnvelope["queryFidelity"]
  url?: string
  compatProvider?: WebSearchProvider
  warnings: string[]
}

const BROWSER_ENGINES: Record<Exclude<BrowserSearchEngine, "custom">, { base: string; parameter: string }> = {
  bing: { base: "https://www.bing.com/search", parameter: "q" },
  google: { base: "https://www.google.com/search", parameter: "q" },
  baidu: { base: "https://www.baidu.com/s", parameter: "wd" },
}

export function buildBrowserSearchURL(config: BrowserSearchConfig, query: string) {
  const fidelity = normalizeWebSearchQuery(query)
  validateBrowserSearchSettings({
    browserSearchEngine: config.engine,
    browserSearchURLTemplate: config.template,
  })
  if (config.engine === "custom") {
    const template = config.template
    if (!template) throw new Error("A custom browser search URL must contain {query}")
    const marker = encodeURIComponent(fidelity.querySent)
    const url = template.replaceAll("{query}", marker)
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Browser search URL must use http(s)")
    return parsed.toString()
  }
  const engine = BROWSER_ENGINES[config.engine]
  const parsed = new URL(engine.base)
  parsed.searchParams.set(engine.parameter, fidelity.querySent)
  return parsed.toString()
}

export function chooseSearchRoute(input: SearchRouteInput): SearchRouteDecision {
  const fidelity = normalizeWebSearchQuery(input.query)
  const warnings = [...fidelity.warnings]
  if (input.route === "compat") {
    if (!input.compatProvider) warnings.push("compat route requires an explicitly selected Exa or Parallel provider")
    return decision(input, fidelity, "compat", undefined, warnings)
  }
  if (input.url) {
    const url = sanitizeWebSearchUrl(input.url) ?? input.url
    if (input.cachedURL) return decision(input, fidelity, "cache", sanitizeWebSearchUrl(input.cachedURL) ?? input.cachedURL, warnings)
    return decision(input, fidelity, "direct", url, warnings)
  }
  if (input.nativeResult && input.nativeResult.sources.length > 0 && input.nativeResult.status !== "failed") {
    return decision(input, fidelity, "native", undefined, warnings)
  }
  if (input.route === "native" && input.nativeAvailable) return decision(input, fidelity, "native", undefined, warnings)
  if (input.hasRegisteredDirectSource) {
    warnings.push("native search unavailable or returned no verifiable URL; using registered direct sources")
    return decision(input, fidelity, "direct", input.registeredDirectURL, warnings)
  }
  const browser = input.browser ?? { engine: "bing" as const }
  if (!input.browser) warnings.push("no browser search engine configured; using Bing for discovery")
  return decision(input, fidelity, "browser", buildBrowserSearchURL(browser, fidelity.querySent), warnings)
}

function decision(
  input: SearchRouteInput,
  fidelity: ReturnType<typeof normalizeWebSearchQuery>,
  route: WebSearchRoute,
  url: string | undefined,
  warnings: string[],
): SearchRouteDecision {
  return {
    route,
    queryOriginal: fidelity.queryOriginal,
    queryPlanned: input.query,
    querySent: fidelity.querySent,
    queryFidelity: fidelity.queryFidelity,
    ...(url ? { url } : {}),
    ...(route === "compat" && input.compatProvider ? { compatProvider: input.compatProvider } : {}),
    warnings,
  }
}

export function routeNeedsFallback(result: Pick<SearchResultEnvelope, "route" | "sources" | "warnings">) {
  if (result.route !== "native") return false
  return result.sources.length === 0 || result.warnings.some((warning) => /failed|no verifiable|status:/i.test(warning))
}
