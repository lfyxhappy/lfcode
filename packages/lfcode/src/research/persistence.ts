import { createHash } from "node:crypto"
import { and, asc, Database, desc, eq, gte, isNull, lt, or } from "@/storage"
import { ulid } from "ulid"
import { canonicalizeWebSearchUrl, sanitizeWebSearchUrl } from "@lfcode-ai/shared/web-search"
import {
  EvidenceRecord,
  EvidenceRecordInput,
  SourceProfile,
  SourceProfileInput,
  SourceSubscription,
  SourceSubscriptionInput,
  SourceObservation,
  cleanPublicUrl,
  defaultEvidenceTTL,
  ResearchSettings,
  ResearchSettingsInput,
  validateBrowserSearchSettings,
} from "./schema"
import { EvidenceRecordTable } from "./evidence.sql"
import { SourceProfileTable } from "./source.sql"
import { SourceObservationTable, SourceSubscriptionTable } from "./subscription.sql"
import { ResearchSettingsTable } from "./settings.sql"

type ProfileRow = typeof SourceProfileTable.$inferSelect
type EvidenceRow = typeof EvidenceRecordTable.$inferSelect
type SubscriptionRow = typeof SourceSubscriptionTable.$inferSelect
type ObservationRow = typeof SourceObservationTable.$inferSelect
type ResearchSettingsRow = typeof ResearchSettingsTable.$inferSelect

export function toResearchSettings(row: ResearchSettingsRow): ResearchSettings {
  return ResearchSettings.parse({
    projectID: row.project_id,
    browserSearchEngine: row.browser_search_engine ?? undefined,
    browserSearchURLTemplate: row.browser_search_url_template ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function getResearchSettings(projectID: string) {
  const row = Database.use((db) => db.select().from(ResearchSettingsTable).where(eq(ResearchSettingsTable.project_id, projectID)).get())
  return row ? toResearchSettings(row) : undefined
}

export function upsertResearchSettings(projectID: string, input: ResearchSettingsInput) {
  const patch = ResearchSettingsInput.parse(input)
  const existing = getResearchSettings(projectID)
  const browserSearchEngine = patch.browserSearchEngine === undefined ? existing?.browserSearchEngine : patch.browserSearchEngine ?? undefined
  const browserSearchURLTemplate =
    patch.browserSearchURLTemplate === undefined ? existing?.browserSearchURLTemplate : patch.browserSearchURLTemplate ?? undefined
  validateBrowserSearchSettings({ browserSearchEngine, browserSearchURLTemplate })
  const now = Date.now()
  const values = {
    project_id: projectID,
    browser_search_engine: browserSearchEngine ?? null,
    browser_search_url_template: browserSearchURLTemplate ?? null,
    time_created: existing?.createdAt ?? now,
    time_updated: now,
  }
  return Database.transaction((db) => {
    db.insert(ResearchSettingsTable)
      .values(values)
      .onConflictDoUpdate({
        target: ResearchSettingsTable.project_id,
        set: {
          browser_search_engine: values.browser_search_engine,
          browser_search_url_template: values.browser_search_url_template,
          time_updated: values.time_updated,
        },
      })
      .run()
    const row = db.select().from(ResearchSettingsTable).where(eq(ResearchSettingsTable.project_id, projectID)).get()
    if (!row) throw new Error("Failed to persist research settings")
    return toResearchSettings(row)
  })
}

export function toSourceProfile(row: ProfileRow): SourceProfile {
  return SourceProfile.parse({
    id: row.id,
    projectID: row.project_id,
    subject: row.subject,
    domains: row.domains,
    paths: row.paths,
    kind: row.kind,
    identity: row.identity,
    officialRepository: row.official_repository ?? undefined,
    refreshPolicy: row.refresh_policy,
    priority: row.priority,
    enabled: row.enabled,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function toEvidenceRecord(row: EvidenceRow): EvidenceRecord {
  return EvidenceRecord.parse({
    id: row.id,
    projectID: row.project_id,
    sourceProfileID: row.source_profile_id ?? undefined,
    url: row.url,
    canonicalURL: row.canonical_url,
    finalURL: row.final_url ?? undefined,
    domain: row.domain,
    title: row.title ?? undefined,
    author: row.author ?? undefined,
    publishedAt: row.published_at ?? undefined,
    sourceUpdatedAt: row.source_updated_at ?? undefined,
    fetchedAt: row.fetched_at,
    contentHash: row.content_hash,
    etag: row.etag ?? undefined,
    lastModified: row.last_modified ?? undefined,
    excerpts: row.excerpts ?? [],
    locator: row.locator ?? undefined,
    attachments: row.attachments ?? [],
    body: row.body ?? undefined,
    sourceIdentity: row.source_identity,
    evidenceStatus: row.evidence_status,
    route: row.route,
    expiresAt: row.expires_at ?? undefined,
    version: row.version,
    metadata: row.metadata ?? {},
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function toSourceSubscription(row: SubscriptionRow): SourceSubscription {
  return SourceSubscription.parse({
    id: row.id,
    projectID: row.project_id,
    sourceProfileID: row.source_profile_id ?? undefined,
    url: row.url,
    kind: row.kind,
    enabled: row.enabled,
    nextCheckAt: row.next_check_at ?? undefined,
    lastCheckedAt: row.last_checked_at ?? undefined,
    etag: row.etag ?? undefined,
    lastModified: row.last_modified ?? undefined,
    contentHash: row.content_hash ?? undefined,
    failureSummary: row.failure_summary ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function toSourceObservation(row: ObservationRow): SourceObservation {
  return SourceObservation.parse({
    id: row.id,
    subscriptionID: row.subscription_id,
    observedAt: row.observed_at,
    changed: row.changed,
    title: row.title ?? undefined,
    url: row.url ?? undefined,
    contentHash: row.content_hash ?? undefined,
    detail: row.detail ?? {},
  })
}

export function upsertSourceProfile(input: SourceProfileInput) {
  const parsed = SourceProfileInput.parse(input)
  const now = Date.now()
  const id = parsed.id ?? ulid()
  const existing = Database.use((db) =>
    db
      .select()
      .from(SourceProfileTable)
      .where(and(eq(SourceProfileTable.project_id, parsed.projectID), eq(SourceProfileTable.subject, parsed.subject)))
      .get(),
  )
  const targetID = existing?.id ?? id
  const values = {
    id: targetID,
    project_id: parsed.projectID,
    subject: parsed.subject,
    domains: parsed.domains.map(normalizeDomain),
    paths: parsed.paths,
    kind: parsed.kind,
    identity: parsed.identity,
    official_repository: parsed.officialRepository ? cleanPublicUrl(parsed.officialRepository) : null,
    refresh_policy: parsed.refreshPolicy,
    priority: parsed.priority,
    enabled: parsed.enabled,
    time_created: existing?.time_created ?? now,
    time_updated: now,
  }
  return Database.transaction((db) => {
    db.insert(SourceProfileTable)
      .values(values)
      .onConflictDoUpdate({
        target: SourceProfileTable.id,
        set: {
          project_id: values.project_id,
          subject: values.subject,
          domains: values.domains,
          paths: values.paths,
          kind: values.kind,
          identity: values.identity,
          official_repository: values.official_repository,
          refresh_policy: values.refresh_policy,
          priority: values.priority,
          enabled: values.enabled,
          time_updated: values.time_updated,
        },
      })
      .run()
    const row = db.select().from(SourceProfileTable).where(eq(SourceProfileTable.id, targetID)).get()
    if (!row) throw new Error("Failed to persist source profile")
    return toSourceProfile(row)
  })
}

export function getSourceProfile(id: string) {
  const row = Database.use((db) => db.select().from(SourceProfileTable).where(eq(SourceProfileTable.id, id)).get())
  return row ? toSourceProfile(row) : undefined
}

export function listSourceProfiles(projectID: string, input?: { enabledOnly?: boolean }) {
  const rows = Database.use((db) => {
    const query = db
      .select()
      .from(SourceProfileTable)
      .where(eq(SourceProfileTable.project_id, projectID))
      .orderBy(desc(SourceProfileTable.priority), asc(SourceProfileTable.subject))
    return query.all()
  })
  return rows.filter((row) => !input?.enabledOnly || row.enabled).map(toSourceProfile)
}

export function deleteSourceProfile(id: string) {
  return Database.use((db) => {
    const row = db.select({ id: SourceProfileTable.id }).from(SourceProfileTable).where(eq(SourceProfileTable.id, id)).get()
    if (!row) return false
    db.delete(SourceProfileTable).where(eq(SourceProfileTable.id, id)).run()
    return true
  })
}

export function upsertEvidence(input: EvidenceRecordInput) {
  const parsed = EvidenceRecordInput.parse(input)
  const cleanURL = cleanPublicUrl(parsed.url)
  const canonicalURL = cleanPublicUrl(parsed.canonicalURL ?? cleanURL)
  const finalURL = parsed.finalURL ? cleanPublicUrl(parsed.finalURL) : undefined
  const now = parsed.fetchedAt ?? Date.now()
  const body = parsed.metadata.sensitive === true ? undefined : redactSensitiveBody(parsed.body)
  const contentHash = parsed.contentHash || hashContent(body ?? parsed.excerpts.map((item) => item.text).join("\n"))
  const existing = Database.use((db) =>
    db
      .select()
      .from(EvidenceRecordTable)
      .where(and(eq(EvidenceRecordTable.project_id, parsed.projectID), eq(EvidenceRecordTable.canonical_url, canonicalURL)))
      .get(),
  )
  const version = existing && existing.content_hash === contentHash ? existing.version : (existing?.version ?? 0) + 1
  const values = {
    id: existing?.id ?? parsed.id ?? ulid(),
    project_id: parsed.projectID,
    source_profile_id: parsed.sourceProfileID ?? null,
    url: cleanURL,
    canonical_url: canonicalURL,
    final_url: finalURL ?? null,
    domain: new URL(canonicalURL).hostname.toLowerCase(),
    title: parsed.title ?? null,
    author: parsed.author ?? null,
    published_at: parsed.publishedAt ?? null,
    source_updated_at: parsed.sourceUpdatedAt ?? null,
    fetched_at: now,
    content_hash: contentHash,
    etag: parsed.etag ?? null,
    last_modified: parsed.lastModified ?? null,
    excerpts: parsed.excerpts,
    locator: parsed.locator ?? null,
    attachments: parsed.attachments,
    body: body ?? null,
    source_identity: parsed.sourceIdentity,
    evidence_status: parsed.evidenceStatus,
    route: parsed.route,
    expires_at: parsed.expiresAt ?? defaultEvidenceTTL("custom", now),
    version,
    metadata: scrubMetadata(parsed.metadata),
    time_created: existing?.time_created ?? now,
    time_updated: Date.now(),
  }
  return Database.transaction((db) => {
    db.insert(EvidenceRecordTable)
      .values(values)
      .onConflictDoUpdate({
        target: [EvidenceRecordTable.project_id, EvidenceRecordTable.canonical_url],
        set: {
          source_profile_id: values.source_profile_id,
          url: values.url,
          final_url: values.final_url,
          domain: values.domain,
          title: values.title,
          author: values.author,
          published_at: values.published_at,
          source_updated_at: values.source_updated_at,
          fetched_at: values.fetched_at,
          content_hash: values.content_hash,
          etag: values.etag,
          last_modified: values.last_modified,
          excerpts: values.excerpts,
          locator: values.locator,
          attachments: values.attachments,
          body: values.body,
          source_identity: values.source_identity,
          evidence_status: values.evidence_status,
          route: values.route,
          expires_at: values.expires_at,
          version: values.version,
          metadata: values.metadata,
          time_updated: values.time_updated,
        },
      })
      .run()
    const row = db.select().from(EvidenceRecordTable).where(eq(EvidenceRecordTable.id, values.id)).get()
    if (!row) throw new Error("Failed to persist evidence record")
    return toEvidenceRecord(row)
  })
}

export function getEvidence(id: string) {
  const row = Database.use((db) => db.select().from(EvidenceRecordTable).where(eq(EvidenceRecordTable.id, id)).get())
  return row ? toEvidenceRecord(row) : undefined
}

export function getEvidenceByURL(projectID: string, url: string) {
  const canonicalURL = cleanPublicUrl(url)
  const row = Database.use((db) =>
    db
      .select()
      .from(EvidenceRecordTable)
      .where(and(eq(EvidenceRecordTable.project_id, projectID), eq(EvidenceRecordTable.canonical_url, canonicalURL)))
      .get(),
  )
  return row ? toEvidenceRecord(row) : undefined
}

export function listEvidence(projectID: string, input?: { limit?: number; freshOnly?: boolean; sourceProfileID?: string }) {
  const now = Date.now()
  const rows = Database.use((db) => {
    const clauses = [
      eq(EvidenceRecordTable.project_id, projectID),
      ...(input?.sourceProfileID ? [eq(EvidenceRecordTable.source_profile_id, input.sourceProfileID)] : []),
    ]
    return db.select().from(EvidenceRecordTable).where(and(...clauses)).orderBy(desc(EvidenceRecordTable.fetched_at)).all()
  })
  return rows
    .filter((row) => !input?.freshOnly || (row.expires_at !== null && row.expires_at > now))
    .slice(0, Math.min(input?.limit ?? 100, 500))
    .map(toEvidenceRecord)
}

export function clearEvidence(projectID: string) {
  return Database.use((db) => {
    const rows = db.select({ id: EvidenceRecordTable.id }).from(EvidenceRecordTable).where(eq(EvidenceRecordTable.project_id, projectID)).all()
    if (rows.length > 0) db.delete(EvidenceRecordTable).where(eq(EvidenceRecordTable.project_id, projectID)).run()
    return rows.length
  })
}

export function deleteEvidence(id: string) {
  return Database.use((db) => {
    const row = db.select({ id: EvidenceRecordTable.id }).from(EvidenceRecordTable).where(eq(EvidenceRecordTable.id, id)).get()
    if (!row) return false
    db.delete(EvidenceRecordTable).where(eq(EvidenceRecordTable.id, id)).run()
    return true
  })
}

export function isEvidenceFresh(record: Pick<EvidenceRecord, "expiresAt">, now = Date.now()) {
  return record.expiresAt !== undefined && record.expiresAt > now
}

export function upsertSubscription(input: SourceSubscriptionInput) {
  const parsed = SourceSubscriptionInput.parse(input)
  const now = Date.now()
  const id = parsed.id ?? ulid()
  const values = {
    id,
    project_id: parsed.projectID,
    source_profile_id: parsed.sourceProfileID ?? null,
    url: cleanPublicUrl(parsed.url),
    kind: parsed.kind,
    enabled: parsed.enabled,
    next_check_at: parsed.nextCheckAt ?? null,
    last_checked_at: parsed.lastCheckedAt ?? null,
    etag: parsed.etag ?? null,
    last_modified: parsed.lastModified ?? null,
    content_hash: parsed.contentHash ?? null,
    failure_summary: parsed.failureSummary ?? null,
    time_created: now,
    time_updated: now,
  }
  return Database.transaction((db) => {
    db.insert(SourceSubscriptionTable)
      .values(values)
      .onConflictDoUpdate({
        target: SourceSubscriptionTable.id,
        set: {
          project_id: values.project_id,
          source_profile_id: values.source_profile_id,
          url: values.url,
          kind: values.kind,
          enabled: values.enabled,
          next_check_at: values.next_check_at,
          last_checked_at: values.last_checked_at,
          etag: values.etag,
          last_modified: values.last_modified,
          content_hash: values.content_hash,
          failure_summary: values.failure_summary,
          time_updated: values.time_updated,
        },
      })
      .run()
    const row = db.select().from(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.id, id)).get()
    if (!row) throw new Error("Failed to persist source subscription")
    return toSourceSubscription(row)
  })
}

export function getSubscription(id: string) {
  const row = Database.use((db) => db.select().from(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.id, id)).get())
  return row ? toSourceSubscription(row) : undefined
}

export function listSubscriptions(projectID: string, input?: { dueBefore?: number; enabledOnly?: boolean }) {
  const rows = Database.use((db) =>
    db.select().from(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.project_id, projectID)).orderBy(asc(SourceSubscriptionTable.next_check_at)).all(),
  )
  return rows
    .filter((row) => !input?.enabledOnly || row.enabled)
    .filter((row) => input?.dueBefore === undefined || row.next_check_at === null || row.next_check_at <= input.dueBefore)
    .map(toSourceSubscription)
}

export function listDueSubscriptions(now = Date.now(), limit = 100) {
  return Database.use((db) =>
    db
      .select()
      .from(SourceSubscriptionTable)
      .where(
        and(
          eq(SourceSubscriptionTable.enabled, true),
          or(isNull(SourceSubscriptionTable.next_check_at), lt(SourceSubscriptionTable.next_check_at, now)),
        ),
      )
      .orderBy(asc(SourceSubscriptionTable.next_check_at))
      .all()
      .slice(0, Math.min(limit, 500))
      .map(toSourceSubscription),
  )
}

export function countObservationsSince(since: number) {
  return Database.use((db) =>
    db
      .select({ id: SourceObservationTable.id })
      .from(SourceObservationTable)
      .where(gte(SourceObservationTable.observed_at, since))
      .all().length,
  )
}

export function countProjectObservationsSince(projectID: string, since: number) {
  return Database.use((db) =>
    db
      .select({ id: SourceObservationTable.id })
      .from(SourceObservationTable)
      .innerJoin(SourceSubscriptionTable, eq(SourceObservationTable.subscription_id, SourceSubscriptionTable.id))
      .where(and(eq(SourceSubscriptionTable.project_id, projectID), gte(SourceObservationTable.observed_at, since)))
      .all().length,
  )
}

export function setSubscriptionEnabled(id: string, enabled: boolean) {
  const row = Database.use((db) =>
    db.update(SourceSubscriptionTable).set({ enabled, time_updated: Date.now() }).where(eq(SourceSubscriptionTable.id, id)).returning().get(),
  )
  return row ? toSourceSubscription(row) : undefined
}

export function recordObservation(input: {
  subscriptionID: string
  changed: boolean
  title?: string
  url?: string
  contentHash?: string
  detail?: Record<string, unknown>
  checkedAt?: number
  nextCheckAt?: number
  etag?: string
  lastModified?: string
  failureSummary?: string
}) {
  const now = input.checkedAt ?? Date.now()
  return Database.transaction((db) => {
    const subscription = db.select().from(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.id, input.subscriptionID)).get()
    if (!subscription) return undefined
    const id = ulid()
    db.insert(SourceObservationTable)
      .values({
        id,
        subscription_id: input.subscriptionID,
        observed_at: now,
        changed: input.changed,
        title: input.title ?? null,
        url: input.url ? cleanPublicUrl(input.url) : null,
        content_hash: input.contentHash ?? null,
        detail: scrubMetadata(input.detail ?? {}),
      })
      .run()
    db.update(SourceSubscriptionTable)
      .set({
        last_checked_at: now,
        next_check_at: input.nextCheckAt ?? null,
        etag: input.etag ?? subscription.etag,
        last_modified: input.lastModified ?? subscription.last_modified,
        content_hash: input.contentHash ?? subscription.content_hash,
        failure_summary: input.failureSummary ?? null,
        time_updated: now,
      })
      .where(eq(SourceSubscriptionTable.id, input.subscriptionID))
      .run()
    const row = db.select().from(SourceObservationTable).where(eq(SourceObservationTable.id, id)).get()
    return row ? toSourceObservation(row) : undefined
  })
}

export function listObservations(subscriptionID: string, limit = 100) {
  return Database.use((db) =>
    db
      .select()
      .from(SourceObservationTable)
      .where(eq(SourceObservationTable.subscription_id, subscriptionID))
      .orderBy(desc(SourceObservationTable.observed_at))
      .all()
      .slice(0, Math.min(limit, 500))
      .map(toSourceObservation),
  )
}

export function clearProjectResearch(projectID: string) {
  return Database.transaction((db) => {
    const settings = db.select({ project_id: ResearchSettingsTable.project_id }).from(ResearchSettingsTable).where(eq(ResearchSettingsTable.project_id, projectID)).all().length
    const evidence = db.select({ id: EvidenceRecordTable.id }).from(EvidenceRecordTable).where(eq(EvidenceRecordTable.project_id, projectID)).all().length
    const subscriptions = db.select({ id: SourceSubscriptionTable.id }).from(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.project_id, projectID)).all().length
    const profiles = db.select({ id: SourceProfileTable.id }).from(SourceProfileTable).where(eq(SourceProfileTable.project_id, projectID)).all().length
    db.delete(ResearchSettingsTable).where(eq(ResearchSettingsTable.project_id, projectID)).run()
    db.delete(EvidenceRecordTable).where(eq(EvidenceRecordTable.project_id, projectID)).run()
    db.delete(SourceSubscriptionTable).where(eq(SourceSubscriptionTable.project_id, projectID)).run()
    db.delete(SourceProfileTable).where(eq(SourceProfileTable.project_id, projectID)).run()
    return { settings, evidence, subscriptions, profiles }
  })
}

export function hashContent(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase()
  if (!candidate) throw new Error("Source profile domain cannot be empty")
  try {
    return new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname.toLowerCase()
  } catch {
    return candidate.replace(/^\.+|\.+$/g, "")
  }
}

function redactSensitiveBody(value: string | undefined) {
  if (!value) return undefined
  return value
    .replace(/([?&]\s*(?:token|secret|password|api[_-]?key|authorization|cookie)[^=]*=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .slice(0, 2_000_000)
}

function scrubMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !/token|secret|password|credential|authorization|cookie|api[_-]?key/i.test(key)),
  )
}
