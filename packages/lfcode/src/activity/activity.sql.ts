import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"

export type ActivityKind = "main" | "subagent" | "checkpoint" | "background"
export type ActivityStatus =
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "recoverable"
  | "completed"
  | "failed"
  | "cancelled"
export type ActivitySourceType = "session" | "actor" | "checkpoint" | "background-job"

export const ActivityTable = sqliteTable(
  "activity",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    parent_activity_id: text(),
    kind: text().$type<ActivityKind>().notNull(),
    status: text().$type<ActivityStatus>().notNull(),
    current_step: text(),
    source_type: text().$type<ActivitySourceType>().notNull(),
    source_id: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    revision: integer().notNull().default(0),
    error: text(),
    ...Timestamps,
    time_started: integer(),
    time_completed: integer(),
  },
  (table) => [
    uniqueIndex("activity_source_idx").on(table.source_type, table.source_id),
    index("activity_session_updated_idx").on(table.session_id, table.time_updated),
    index("activity_parent_idx").on(table.parent_activity_id),
    index("activity_status_idx").on(table.status),
  ],
)
