import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const SourceProfileTable = sqliteTable(
  "research_source_profile",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    subject: text().notNull(),
    domains: text({ mode: "json" }).$type<string[]>().notNull(),
    paths: text({ mode: "json" }).$type<string[]>().notNull(),
    kind: text().notNull(),
    identity: text().notNull(),
    official_repository: text(),
    refresh_policy: text({ mode: "json" }).$type<{ strategy: string; ttlSeconds?: number }>().notNull(),
    priority: integer().notNull().default(0),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    ...Timestamps,
  },
  (table) => [
    index("research_source_profile_project_idx").on(table.project_id, table.priority),
    index("research_source_profile_domain_idx").on(table.project_id, table.identity),
    uniqueIndex("research_source_profile_project_subject_idx").on(table.project_id, table.subject),
  ],
)
