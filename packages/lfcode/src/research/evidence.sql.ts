import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import { SourceProfileTable } from "./source.sql"

export const EvidenceRecordTable = sqliteTable(
  "research_evidence_record",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    source_profile_id: text().references(() => SourceProfileTable.id, { onDelete: "set null" }),
    url: text().notNull(),
    canonical_url: text().notNull(),
    final_url: text(),
    domain: text().notNull(),
    title: text(),
    author: text(),
    published_at: text(),
    source_updated_at: text(),
    fetched_at: integer().notNull(),
    content_hash: text().notNull(),
    etag: text(),
    last_modified: text(),
    excerpts: text({ mode: "json" }).$type<Array<{ text: string; locator?: string }>>().notNull(),
    locator: text({ mode: "json" }).$type<Record<string, unknown>>(),
    attachments: text({ mode: "json" }).$type<string[]>().notNull(),
    body: text(),
    source_identity: text().notNull(),
    evidence_status: text().notNull(),
    route: text().notNull(),
    expires_at: integer(),
    version: integer().notNull().default(1),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("research_evidence_project_canonical_idx").on(table.project_id, table.canonical_url),
    index("research_evidence_project_fetched_idx").on(table.project_id, table.fetched_at),
    index("research_evidence_project_status_idx").on(table.project_id, table.evidence_status),
    index("research_evidence_profile_idx").on(table.source_profile_id),
  ],
)

