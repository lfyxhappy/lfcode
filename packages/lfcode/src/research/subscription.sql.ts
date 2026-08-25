import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import { SourceProfileTable } from "./source.sql"

export const SourceSubscriptionTable = sqliteTable(
  "research_source_subscription",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    source_profile_id: text().references(() => SourceProfileTable.id, { onDelete: "set null" }),
    url: text().notNull(),
    kind: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    next_check_at: integer(),
    last_checked_at: integer(),
    etag: text(),
    last_modified: text(),
    content_hash: text(),
    failure_summary: text(),
    ...Timestamps,
  },
  (table) => [
    index("research_subscription_project_idx").on(table.project_id, table.enabled),
    index("research_subscription_due_idx").on(table.enabled, table.next_check_at),
  ],
)

export const SourceObservationTable = sqliteTable(
  "research_source_observation",
  {
    id: text().primaryKey(),
    subscription_id: text()
      .notNull()
      .references(() => SourceSubscriptionTable.id, { onDelete: "cascade" }),
    observed_at: integer().notNull(),
    changed: integer({ mode: "boolean" }).notNull(),
    title: text(),
    url: text(),
    content_hash: text(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("research_observation_subscription_idx").on(table.subscription_id, table.observed_at)],
)

