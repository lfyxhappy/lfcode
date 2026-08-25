export const WEB_SEARCH_PROVIDERS = ["exa", "parallel"] as const
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]

/** Discovery/retrieval routes exposed by the V2 search contract. */
export const WEB_SEARCH_ROUTES = ["native", "direct", "browser", "cache", "compat"] as const
export type WebSearchRoute = (typeof WEB_SEARCH_ROUTES)[number]

export const WEB_SEARCH_SOURCE_IDENTITIES = [
  "official",
  "institutional",
  "independent",
  "practitioner",
  "discovery",
] as const
export type WebSearchSourceIdentity = (typeof WEB_SEARCH_SOURCE_IDENTITIES)[number]

export const WEB_SEARCH_EVIDENCE_STATUSES = [
  "unverified",
  "metadata_verified",
  "content_verified",
  "corroborated",
] as const
export type WebSearchEvidenceStatus = (typeof WEB_SEARCH_EVIDENCE_STATUSES)[number]

export type WebSearchSourceTier = "primary" | "authoritative-secondary" | "practitioner" | "discovery-only"

export type WebSearchSource = {
  url: string
  domain: string
  sourceTier: WebSearchSourceTier
  title?: string
  snippet?: string
  publishedAt?: string
  canonicalUrl?: string
  finalUrl?: string
  updatedAt?: string
  sourceIdentity?: WebSearchSourceIdentity
  evidenceStatus?: WebSearchEvidenceStatus
  evidenceID?: string
}

export type WebSearchQueryFidelity = "exact" | "normalized" | "suspect"

export type WebSearchQuery = {
  queryOriginal: string
  querySent: string
  queryFidelity: WebSearchQueryFidelity
  warnings: string[]
}

export type SearchResultEnvelope = {
  route: WebSearchRoute
  queryOriginal: string
  queryPlanned?: string
  querySent: string
  queryFidelity: WebSearchQueryFidelity
  provider: WebSearchProvider | "native" | WebSearchRoute
  attemptedProviders: WebSearchProvider[]
  sources: WebSearchSource[]
  warnings: string[]
  limits?: { maxResults?: number; maxContextCharacters?: number }
  conflicts?: string[]
}

export type NativeWebSearchResult = SearchResultEnvelope & {
  route: "native"
  provider: "native"
}

export type WebSearchFailureClass =
  | "transport"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "empty_response"
  | "parse_failure"
  | "missing_credentials"

export function getWebSearchProviderOrder(provider?: WebSearchProvider) {
  if (provider) return [provider]
  return [...WEB_SEARCH_PROVIDERS]
}

export function normalizeWebSearchQuery(value: string): WebSearchQuery {
  const queryOriginal = value
  const querySent = value.normalize("NFC")
  const warnings: string[] = []
  const literalEscape = /\\u[0-9a-f]{4}/i.test(querySent)
  const replacementCharacter = querySent.includes("\uFFFD")
  const controlCharacter = [...querySent].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f
  })
  const invalidSurrogate = /\p{Cs}/u.test(querySent)
  if (querySent !== queryOriginal) warnings.push("query normalized to Unicode NFC")
  if (literalEscape) warnings.push("query contains a literal Unicode escape")
  if (replacementCharacter) warnings.push("query contains the Unicode replacement character")
  if (controlCharacter) warnings.push("query contains control characters")
  if (invalidSurrogate) warnings.push("query contains an invalid surrogate")
  return {
    queryOriginal,
    querySent,
    queryFidelity:
      literalEscape || replacementCharacter || controlCharacter || invalidSurrogate
        ? "suspect"
        : querySent === queryOriginal
          ? "exact"
          : "normalized",
    warnings,
  }
}

export function isRetryableWebSearchFailure(failure: WebSearchFailureClass) {
  return failure === "transport" || failure === "timeout" || failure === "http_5xx" || failure === "empty_response" || failure === "parse_failure"
}

export function extractWebSearchSources(text: string) {
  const sources = new Map<string, WebSearchSource>()
  const links = /(?:\[([^\]]+)\]\()?(https?:\/\/[^\s<>"')\]]+)/giu
  for (const match of text.matchAll(links)) {
    const canonical = canonicalizeWebSearchUrl(match[2] ?? "")
    if (!canonical || sources.has(canonical)) continue
    const parsed = safeWebSearchUrl(canonical)
    if (!parsed) continue
    const title = match[1]?.trim()
    sources.set(canonical, {
      url: canonical,
      domain: parsed.hostname,
      sourceTier: getWebSearchSourceTier(parsed),
      ...(title ? { title } : {}),
    })
  }
  return [...sources.values()]
}

/**
 * Normalizes structured sources returned by provider-native search APIs. The
 * providers disagree on field names, so this deliberately accepts a small
 * read-only superset and only keeps public citation fields for the UI.
 */
export function normalizeWebSearchSources(value: unknown) {
  if (!Array.isArray(value)) return [] as WebSearchSource[]
  const sources = new Map<string, WebSearchSource>()
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const rawUrl = firstWebSearchString(record, ["url", "href", "link", "uri"])
    const url = rawUrl ? canonicalizeWebSearchUrl(rawUrl) : undefined
    if (!url || sources.has(url)) continue
    const parsed = safeWebSearchUrl(url)
    if (!parsed) continue
    const title = firstWebSearchString(record, ["title", "name", "label"])
    const snippet = firstWebSearchString(record, ["snippet", "description", "summary", "text", "content"])
    const publishedAt = firstWebSearchString(record, ["publishedAt", "published_at", "date", "published"])
    sources.set(url, {
      url,
      domain: parsed.hostname,
      sourceTier: getWebSearchSourceTier(parsed),
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    })
  }
  return [...sources.values()]
}

export function nativeWebSearchResult(input: { query?: string; sources?: unknown; status?: string }): NativeWebSearchResult {
  const query = normalizeWebSearchQuery(input.query ?? "")
  const sources = normalizeWebSearchSources(input.sources)
  const warnings = [...query.warnings]
  if (input.status && input.status !== "completed") warnings.push(`native search status: ${input.status}`)
  if (sources.length === 0) warnings.push("native search returned no verifiable URL sources")
  return {
    route: "native",
    provider: "native",
    queryOriginal: query.queryOriginal,
    querySent: query.querySent,
    queryFidelity: query.queryFidelity,
    attemptedProviders: [],
    sources,
    warnings,
  }
}

export function nativeWebSearchNeedsFallback(result: NativeWebSearchResult) {
  return result.sources.length === 0 || result.warnings.some((warning) => warning.startsWith("native search status:"))
}

export function canonicalizeWebSearchUrl(value: string) {
  const parsed = safeWebSearchUrl(value)
  if (!parsed) return
  parsed.username = ""
  parsed.password = ""
  parsed.hash = ""
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") parsed.searchParams.delete(key)
  }
  return parsed.toString()
}

/**
 * Remove credentials and tracking material before a URL enters project
 * storage. This deliberately leaves ordinary query parameters intact because
 * they can be part of the resource identity (for example a release version).
 */
export function sanitizeWebSearchUrl(value: string) {
  const canonical = canonicalizeWebSearchUrl(value)
  if (!canonical) return
  const parsed = new URL(canonical)
  parsed.username = ""
  parsed.password = ""
  for (const key of [...parsed.searchParams.keys()]) {
    if (/token|secret|password|credential|authorization|cookie|api[_-]?key|sig(?:nature)?/i.test(key)) {
      parsed.searchParams.delete(key)
    }
  }
  return parsed.toString()
}

/**
 * Reject non-public HTTP endpoints before a research fetch is attempted.
 * This is intentionally a synchronous hostname/IP guard; callers must also
 * validate the final URL after redirects because an initially public URL can
 * redirect into a private network.
 */
export function isPublicWebSearchUrl(value: string) {
  const parsed = safeWebSearchUrl(value)
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return false
  if (parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false
  }
  if (isPrivateIPv4(host)) return false
  if (isPrivateIPv6(host)) return false
  return true
}

function safeWebSearchUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return
  }
}

function firstWebSearchString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
}

function getWebSearchSourceTier(url: URL): WebSearchSourceTier {
  const host = url.hostname.toLowerCase()
  if (
    host.endsWith(".gov") ||
    host.endsWith(".gov.cn") ||
    host.endsWith(".edu") ||
    host.endsWith(".ac.uk") ||
    host === "ietf.org" ||
    host.endsWith(".ietf.org") ||
    host === "w3.org" ||
    host.endsWith(".w3.org") ||
    host === "whatwg.org" ||
    host.endsWith(".whatwg.org") ||
    host === "rfc-editor.org" ||
    host.endsWith(".rfc-editor.org") ||
    host === "arxiv.org" ||
    host.endsWith(".arxiv.org") ||
    host === "doi.org" ||
    host.endsWith(".doi.org")
  ) {
    return "primary"
  }
  if (
    ["reuters.com", "apnews.com", "bbc.com", "nature.com", "science.org", "arstechnica.com", "theverge.com"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  ) {
    return "authoritative-secondary"
  }
  if (["developer.mozilla.org", "dev.to", "medium.com", "css-tricks.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "practitioner"
  }
  return "discovery-only"
}

function isPrivateIPv4(host: string) {
  const octets = host.split(".")
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part))) return false
  const values = octets.map(Number)
  if (values.some((value) => value < 0 || value > 255)) return false
  const [first, second] = values
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isPrivateIPv6(host: string) {
  const normalized = host.toLowerCase()
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true
  if (normalized.startsWith("::ffff:")) return isPrivateIPv4(normalized.slice("::ffff:".length))
  return false
}
