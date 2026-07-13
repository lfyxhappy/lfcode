import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MaintenanceRunTable = sqliteTable(
  "maintenance_run",
  {
    id: text().primaryKey(),
    day_key: text().notNull(),
    job_kind: text().notNull(),
    trigger_source: text().notNull(),
    status: text().notNull(),
    dream_status: text().notNull(),
    distill_status: text().notNull(),
    project_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    summary: text(),
    error_excerpt: text(),
    candidate_count: integer().notNull().default(0),
    started_at: integer().notNull(),
    finished_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("maintenance_run_day_idx").on(table.day_key),
    index("maintenance_run_status_idx").on(table.status),
  ],
)

export const MaintenanceCandidateTable = sqliteTable(
  "maintenance_candidate",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => MaintenanceRunTable.id, { onDelete: "cascade" }),
    candidate_kind: text().notNull(),
    target_kind: text().notNull(),
    target_path: text(),
    evidence: text({ mode: "json" }).$type<string[]>().notNull(),
    confidence: integer().notNull(),
    proposed_summary: text().notNull(),
    proposed_patch_preview: text(),
    status: text().notNull(),
    applied_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("maintenance_candidate_run_idx").on(table.run_id),
    index("maintenance_candidate_status_idx").on(table.status),
  ],
)

export const MaintenanceCandidateEventTable = sqliteTable(
  "maintenance_candidate_event",
  {
    id: text().primaryKey(),
    candidate_id: text()
      .notNull()
      .references(() => MaintenanceCandidateTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("maintenance_candidate_event_candidate_idx").on(table.candidate_id, table.time_created),
  ],
)

export const MaintenanceLockTable = sqliteTable("maintenance_lock", {
  id: text().primaryKey(),
  owner_run_id: text().notNull(),
  expires_at: integer().notNull(),
  ...Timestamps,
})
