import { sanitizeWebSearchUrl, type WebSearchRoute } from "@lfcode-ai/shared/web-search"
import { cleanPublicUrl, defaultEvidenceTTL, type EvidenceExcerpt, type EvidenceRecord, type EvidenceRecordInput } from "./schema"
import { getSourceProfile, listSourceProfiles, hashContent, upsertEvidence } from "./persistence"
import { matchSourceProfile, sourceToWebSearchSource } from "./registry"

const MAX_DIRECT_BODY_BYTES = 5 * 1024 * 1024

export type DirectFetchResult =
  | { status: "not_modified"; url: string; etag?: string; lastModified?: string; record?: EvidenceRecord }
  | { status: "stored"; url: string; record: EvidenceRecord; headers: Record<string, string> }

export type DirectFetchInput = {
  projectID: string
  url: string
  sourceProfileID?: string
  route?: Extract<WebSearchRoute, "direct" | "browser" | "compat">
  existing?: EvidenceRecord
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: number
}

export async function fetchAndStoreEvidence(input: DirectFetchInput): Promise<DirectFetchResult> {
  const url = cleanPublicUrl(input.url)
  const now = input.now ?? Date.now()
  const selectedProfile = input.sourceProfileID ? getSourceProfile(input.sourceProfileID) : undefined
  const profiles = selectedProfile?.projectID === input.projectID && selectedProfile.enabled ? [selectedProfile] : listSourceProfiles(input.projectID, { enabledOnly: true })
  const refreshExpiresAt = defaultEvidenceTTL(selectedProfile?.kind ?? "custom", now)
  const fetcher = input.fetcher ?? fetch
  const headers: Record<string, string> = {
    Accept: "text/html, application/xhtml+xml, text/plain, application/json;q=0.8",
    "User-Agent": "lfcode-research/2",
  }
  if (input.existing?.etag) headers["If-None-Match"] = input.existing.etag
  if (input.existing?.lastModified) headers["If-Modified-Since"] = input.existing.lastModified
  const response = await fetcher(url, { headers, redirect: "follow" })
  const responseHeaders = Object.fromEntries(response.headers.entries())
  if (response.status === 304) {
    const record = input.existing
      ? upsertEvidence({
          projectID: input.existing.projectID,
          ...(input.existing.sourceProfileID ? { sourceProfileID: input.existing.sourceProfileID } : {}),
          url: input.existing.url,
          canonicalURL: input.existing.canonicalURL,
          finalURL: input.existing.finalURL,
          domain: input.existing.domain,
          title: input.existing.title,
          author: input.existing.author,
          publishedAt: input.existing.publishedAt,
          sourceUpdatedAt: input.existing.sourceUpdatedAt,
          contentHash: input.existing.contentHash,
          etag: responseHeaders.etag ?? input.existing.etag,
          lastModified: responseHeaders["last-modified"] ?? input.existing.lastModified,
          excerpts: input.existing.excerpts,
          locator: input.existing.locator,
          attachments: input.existing.attachments,
          body: input.existing.body,
          sourceIdentity: input.existing.sourceIdentity,
          evidenceStatus: input.existing.evidenceStatus,
          route: input.existing.route,
          expiresAt: refreshExpiresAt,
          metadata: input.existing.metadata,
          fetchedAt: now,
        })
      : undefined
    return {
      status: "not_modified",
      url,
      ...(responseHeaders.etag ? { etag: responseHeaders.etag } : {}),
      ...(responseHeaders["last-modified"] ? { lastModified: responseHeaders["last-modified"] } : {}),
      record,
    }
  }
  if (!response.ok) throw new Error(`Direct source request failed: ${response.status}`)
  const body = await response.text()
  if (new TextEncoder().encode(body).byteLength > MAX_DIRECT_BODY_BYTES) throw new Error("Direct source response exceeds 5MB")
  const metadata = extractPageMetadata(body, response.url || url)
  const source = sourceToWebSearchSource({
    url: response.url || url,
    title: metadata.title,
    publishedAt: metadata.publishedAt,
    updatedAt: metadata.sourceUpdatedAt,
    profiles,
  })
  const sourceMatch = matchSourceProfile(response.url || url, profiles)
  const expiresAt = defaultEvidenceTTL(sourceMatch.profile?.kind ?? "custom", now)
  const excerpts = metadata.excerpts
  const recordInput: EvidenceRecordInput = {
    projectID: input.projectID,
    ...(input.sourceProfileID ? { sourceProfileID: input.sourceProfileID } : {}),
    url,
    canonicalURL: metadata.canonicalURL,
    finalURL: response.url && response.url !== url ? response.url : undefined,
    domain: new URL(metadata.canonicalURL).hostname,
    title: metadata.title,
    author: metadata.author,
    publishedAt: metadata.publishedAt,
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    contentHash: hashContent(metadata.body ?? ""),
    etag: responseHeaders.etag,
    lastModified: responseHeaders["last-modified"],
    excerpts,
    locator: metadata.locator,
    attachments: [],
    body: metadata.sensitive ? undefined : metadata.body,
    sourceIdentity: source?.sourceIdentity ?? "discovery",
    evidenceStatus: metadata.sensitive || !metadata.body ? "metadata_verified" : "content_verified",
    route: input.route ?? "direct",
    expiresAt,
    metadata: {
      contentType: responseHeaders["content-type"],
      sensitive: metadata.sensitive,
      ...(metadata.jsonLd && !metadata.sensitive ? { jsonLd: metadata.jsonLd } : {}),
    },
    fetchedAt: now,
  }
  const record = upsertEvidence(recordInput)
  return { status: "stored", url, record, headers: responseHeaders }
}

export function extractPageMetadata(html: string, requestedURL: string) {
  const canonicalURL = sanitizeWebSearchUrl(readAttribute(html, "link", "canonical") ?? requestedURL) ?? requestedURL
  const title = cleanText(readTag(html, "title"))
  const author = readMeta(html, ["author", "article:author"])
  const publishedAt = readMeta(html, ["article:published_time", "datePublished", "date"])
  const sourceUpdatedAt = readMeta(html, ["article:modified_time", "dateModified", "lastmod"])
  const jsonLd = extractJsonLd(html)
  const body = (cleanText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ) ?? "").slice(0, 2_000_000)
  const sensitive = /(?:\/login|\/signin|\/auth(?:entication)?\b)/i.test(canonicalURL) || /<input[^>]+type=["']password/i.test(html)
  const excerpts: EvidenceExcerpt[] = body
    ? [{ text: body.slice(0, 1200), locator: "body:first-text" }]
    : []
  return {
    canonicalURL,
    title,
    author,
    publishedAt,
    sourceUpdatedAt,
    body,
    excerpts,
    locator: { title: title ? "title" : undefined },
    jsonLd,
    sensitive,
  }
}

function readTag(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))
  return match?.[1]
}

function readMeta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"))
    if (match?.[1]) return match[1].trim()
  }
}

function readAttribute(html: string, tag: string, relation: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*(?:rel=["'][^"']*${relation}[^"']*["'])[^>]*>`, "i"))
  if (!match) return
  return match[0].match(/href=["']([^"']+)["']/i)?.[1]
}

function extractJsonLd(html: string) {
  const values = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
  return values.length > 0 ? values : undefined
}

function cleanText(value: string | undefined) {
  return value
    ?.replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
}
