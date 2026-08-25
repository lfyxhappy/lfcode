import {
  canonicalizeWebSearchUrl,
  type WebSearchSource,
  type WebSearchSourceIdentity,
  type WebSearchEvidenceStatus,
} from "@lfcode-ai/shared/web-search"
import type { SourceProfile, SourceKind } from "./schema"

export type SourceMatch = {
  profile?: SourceProfile
  identity: WebSearchSourceIdentity
  evidenceStatus: WebSearchEvidenceStatus
  reason: string
}

/** Match by an explicit profile; never treats `docs.` or GitHub as official by itself. */
export function matchSourceProfile(url: string, profiles: readonly SourceProfile[]): SourceMatch {
  const canonical = canonicalizeWebSearchUrl(url)
  if (!canonical) {
    return { identity: "discovery", evidenceStatus: "unverified", reason: "invalid URL" }
  }
  const parsed = new URL(canonical)
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname || "/"
  const matches = profiles
    .filter((profile) => profile.enabled)
    .filter((profile) => profile.domains.some((domain) => domainMatches(host, domain)))
    .filter((profile) => profile.paths.length === 0 || profile.paths.some((prefix) => pathMatches(path, prefix)))
    .toSorted((a, b) => b.priority - a.priority || a.subject.localeCompare(b.subject))
  const profile = matches[0]
  if (!profile) return { identity: "discovery", evidenceStatus: "unverified", reason: "no registered source profile" }
  const officialRepository = profile.officialRepository ? canonicalizeWebSearchUrl(profile.officialRepository) : undefined
  const officialBinding = officialRepository ? sameRepositoryRoot(canonical, officialRepository) : false
  const githubRepository = host === "github.com" || host.endsWith(".github.com")
  const identity = githubRepository && profile.identity === "official" && !officialBinding ? "discovery" : profile.identity
  return {
    profile,
    identity,
    evidenceStatus: identity === "official" || identity === "institutional" ? "metadata_verified" : "unverified",
    reason:
      githubRepository && profile.identity === "official" && !officialBinding
        ? "GitHub repositories require an explicit official repository binding"
        : officialBinding
          ? "matched registered profile and official repository binding"
          : "matched registered source profile",
  }
}

export function classifySource(url: string, profiles: readonly SourceProfile[] = []): SourceMatch {
  return matchSourceProfile(url, profiles)
}

export function sourceToWebSearchSource(input: {
  url: string
  title?: string
  snippet?: string
  finalUrl?: string
  publishedAt?: string
  updatedAt?: string
  profiles?: readonly SourceProfile[]
  sourceIdentity?: WebSearchSourceIdentity
  evidenceID?: string
  evidenceStatus?: WebSearchEvidenceStatus
}): WebSearchSource | undefined {
  const canonical = canonicalizeWebSearchUrl(input.url)
  if (!canonical) return
  const parsed = new URL(canonical)
  const match = classifySource(canonical, input.profiles)
  const sourceIdentity = input.sourceIdentity ?? match.identity
  const sourceTier = tierForIdentity(sourceIdentity)
  return {
    url: canonical,
    canonicalUrl: canonical,
    domain: parsed.hostname.toLowerCase(),
    sourceTier,
    ...(input.title ? { title: input.title } : {}),
    ...(input.snippet ? { snippet: input.snippet } : {}),
    ...(input.finalUrl ? { finalUrl: input.finalUrl } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    sourceIdentity,
    evidenceStatus: input.evidenceStatus ?? match.evidenceStatus,
    ...(input.evidenceID ? { evidenceID: input.evidenceID } : {}),
  }
}

function domainMatches(host: string, domain: string) {
  const normalized = domain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? ""
  return host === normalized || host.endsWith(`.${normalized}`)
}

function pathMatches(path: string, prefix: string) {
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`
  return path === normalized || path.startsWith(`${normalized.replace(/\/$/, "")}/`)
}

function sameRepositoryRoot(left: string, right: string) {
  const a = new URL(left)
  const b = new URL(right)
  const root = b.pathname.replace(/\/$/, "")
  if ((b.hostname === "github.com" || b.hostname.endsWith(".github.com")) && root.split("/").filter(Boolean).length < 2) return false
  return a.hostname.toLowerCase() === b.hostname.toLowerCase() && (a.pathname === root || a.pathname.startsWith(`${root}/`))
}

function tierForIdentity(identity: WebSearchSourceIdentity) {
  if (identity === "official" || identity === "institutional") return "primary" as const
  if (identity === "independent") return "authoritative-secondary" as const
  if (identity === "practitioner") return "practitioner" as const
  return "discovery-only" as const
}

export function defaultSourceProfile(input: {
  projectID: string
  subject: string
  domain: string
  kind?: SourceKind
  identity?: WebSearchSourceIdentity
}) {
  return {
    projectID: input.projectID,
    subject: input.subject,
    domains: [input.domain],
    paths: [],
    kind: input.kind ?? "custom",
    identity: input.identity ?? "official",
    refreshPolicy: { strategy: "manual" as const },
    priority: 0,
    enabled: true,
  }
}

export function sourceProfileEntryURL(profile: Pick<SourceProfile, "domains" | "paths" | "officialRepository">) {
  if (profile.officialRepository) return canonicalizeWebSearchUrl(profile.officialRepository)
  const domain = profile.domains[0]
  if (!domain) return
  const path = profile.paths[0] ?? "/"
  const url = `https://${domain}${path.startsWith("/") ? path : `/${path}`}`
  return canonicalizeWebSearchUrl(url)
}
