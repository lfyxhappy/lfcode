import z from "zod"
import {
  WEB_SEARCH_EVIDENCE_STATUSES,
  WEB_SEARCH_SOURCE_IDENTITIES,
  sanitizeWebSearchUrl,
  type WebSearchEvidenceStatus,
  type WebSearchRoute,
  type WebSearchSourceIdentity,
} from "@lfcode-ai/shared/web-search"

export const SourceKind = z.enum(["technical", "academic", "policy", "product", "news", "custom"])
export type SourceKind = z.infer<typeof SourceKind>

export const BrowserSearchEngine = z.enum(["bing", "google", "baidu", "custom"])
export type BrowserSearchEngine = z.infer<typeof BrowserSearchEngine>

export const ResearchSettings = z.object({
  projectID: z.string().min(1),
  browserSearchEngine: BrowserSearchEngine.optional(),
  browserSearchURLTemplate: z.string().max(2_000).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type ResearchSettings = z.infer<typeof ResearchSettings>

export const ResearchSettingsInput = z
  .object({
    browserSearchEngine: BrowserSearchEngine.nullish(),
    browserSearchURLTemplate: z.string().max(2_000).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.browserSearchEngine === "custom") {
      if (!value.browserSearchURLTemplate?.includes("{query}")) {
        ctx.addIssue({
          code: "custom",
          path: ["browserSearchURLTemplate"],
          message: "A custom browser search URL must contain {query}",
        })
        return
      }
      try {
        const url = new URL(value.browserSearchURLTemplate.replaceAll("{query}", "query"))
        if (url.protocol === "http:" || url.protocol === "https:") return
      } catch {}
      ctx.addIssue({
        code: "custom",
        path: ["browserSearchURLTemplate"],
        message: "Browser search URL must use http(s)",
      })
      return
    }
    if (value.browserSearchEngine && value.browserSearchURLTemplate) {
      ctx.addIssue({
        code: "custom",
        path: ["browserSearchURLTemplate"],
        message: "A custom browser URL template requires the custom search engine",
      })
    }
  })
export type ResearchSettingsInput = z.infer<typeof ResearchSettingsInput>

export const RefreshPolicy = z
  .object({
    strategy: z.enum(["manual", "hourly", "daily", "weekly"]).default("manual"),
    ttlSeconds: z.number().int().positive().optional(),
  })
  .default({ strategy: "manual" })
export type RefreshPolicy = z.infer<typeof RefreshPolicy>

export const SourceProfile = z.object({
  id: z.string().min(1),
  projectID: z.string().min(1),
  subject: z.string().min(1),
  domains: z.array(z.string().min(1)).min(1),
  paths: z.array(z.string().min(1)).default([]),
  kind: SourceKind.default("custom"),
  identity: z.enum(WEB_SEARCH_SOURCE_IDENTITIES).default("discovery"),
  officialRepository: z.string().url().optional(),
  refreshPolicy: RefreshPolicy,
  priority: z.number().int().min(-1000).max(1000).default(0),
  enabled: z.boolean().default(true),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type SourceProfile = z.infer<typeof SourceProfile>

export const SourceProfileInput = SourceProfile.omit({ id: true, createdAt: true, updatedAt: true }).extend({
  id: z.string().min(1).optional(),
})
export type SourceProfileInput = z.infer<typeof SourceProfileInput>

export const EvidenceExcerpt = z.object({
  text: z.string().min(1).max(20_000),
  locator: z.string().max(500).optional(),
})
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerpt>

export const EvidenceRecord = z.object({
  id: z.string().min(1),
  projectID: z.string().min(1),
  sourceProfileID: z.string().min(1).optional(),
  url: z.string().url(),
  canonicalURL: z.string().url(),
  finalURL: z.string().url().optional(),
  domain: z.string().min(1),
  title: z.string().max(1000).optional(),
  author: z.string().max(500).optional(),
  publishedAt: z.string().max(100).optional(),
  sourceUpdatedAt: z.string().max(100).optional(),
  fetchedAt: z.number().int(),
  contentHash: z.string().min(1),
  etag: z.string().max(500).optional(),
  lastModified: z.string().max(100).optional(),
  excerpts: z.array(EvidenceExcerpt).default([]),
  locator: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(z.string().max(1000)).default([]),
  body: z.string().max(2_000_000).optional(),
  sourceIdentity: z.enum(WEB_SEARCH_SOURCE_IDENTITIES),
  evidenceStatus: z.enum(WEB_SEARCH_EVIDENCE_STATUSES),
  route: z.enum(["native", "direct", "browser", "cache", "compat"]),
  expiresAt: z.number().int().optional(),
  version: z.number().int().positive().default(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type EvidenceRecord = z.infer<typeof EvidenceRecord>
export type EvidenceStatus = WebSearchEvidenceStatus
export type SourceIdentity = WebSearchSourceIdentity
export type EvidenceRoute = WebSearchRoute

export const EvidenceRecordInput = EvidenceRecord.omit({
  id: true,
  fetchedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  id: z.string().min(1).optional(),
  fetchedAt: z.number().int().optional(),
})
export type EvidenceRecordInput = z.infer<typeof EvidenceRecordInput>

export const SourceSubscription = z.object({
  id: z.string().min(1),
  projectID: z.string().min(1),
  sourceProfileID: z.string().min(1).optional(),
  url: z.string().url(),
  kind: z.enum(["rss", "atom", "sitemap", "release", "document"]),
  enabled: z.boolean(),
  nextCheckAt: z.number().int().optional(),
  lastCheckedAt: z.number().int().optional(),
  etag: z.string().max(500).optional(),
  lastModified: z.string().max(100).optional(),
  contentHash: z.string().max(128).optional(),
  failureSummary: z.string().max(1000).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type SourceSubscription = z.infer<typeof SourceSubscription>

export const SourceSubscriptionInput = SourceSubscription.omit({ id: true, createdAt: true, updatedAt: true }).extend({
  id: z.string().min(1).optional(),
})
export type SourceSubscriptionInput = z.infer<typeof SourceSubscriptionInput>

export const SourceObservation = z.object({
  id: z.string().min(1),
  subscriptionID: z.string().min(1),
  observedAt: z.number().int(),
  changed: z.boolean(),
  title: z.string().max(1000).optional(),
  url: z.string().url().optional(),
  contentHash: z.string().max(128).optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
})
export type SourceObservation = z.infer<typeof SourceObservation>

export function cleanPublicUrl(value: string) {
  const clean = sanitizeWebSearchUrl(value)
  if (!clean) throw new Error("A valid http(s) URL is required")
  const parsed = new URL(clean)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http(s) URLs are allowed")
  return clean
}

export function defaultEvidenceTTL(kind: SourceKind, now = Date.now()) {
  const ttl = kind === "news" || kind === "product" ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  return now + ttl
}

export function validateBrowserSearchSettings(input: Pick<ResearchSettings, "browserSearchEngine" | "browserSearchURLTemplate">) {
  if (input.browserSearchEngine === "custom") {
    if (!input.browserSearchURLTemplate?.includes("{query}")) {
      throw new Error("A custom browser search URL must contain {query}")
    }
    const value = input.browserSearchURLTemplate.replaceAll("{query}", "query")
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser search URL must use http(s)")
    return
  }
  if (input.browserSearchURLTemplate) throw new Error("A custom browser URL template requires the custom search engine")
}
