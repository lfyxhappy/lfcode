export const WEB_SEARCH_PROVIDERS = ["exa", "parallel"] as const
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]

export type WebSearchSourceTier = "primary" | "authoritative-secondary" | "practitioner" | "discovery-only"

export type WebSearchSource = {
  url: string
  domain: string
  sourceTier: WebSearchSourceTier
  title?: string
  snippet?: string
  publishedAt?: string
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

export function canonicalizeWebSearchUrl(value: string) {
  const parsed = safeWebSearchUrl(value)
  if (!parsed) return
  parsed.hash = ""
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") parsed.searchParams.delete(key)
  }
  return parsed.toString()
}

function safeWebSearchUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return
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
    host.endsWith(".doi.org") ||
    host === "github.com" ||
    host.endsWith(".github.com") ||
    host.startsWith("docs.")
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
