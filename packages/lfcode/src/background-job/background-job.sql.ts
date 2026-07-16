import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID, MessageID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"

export type BackgroundJobStatus = "running" | "completed" | "failed" | "cancelled"
export type BackgroundJobStream = "stdout" | "stderr" | "system"

export const BackgroundJobTable = sqliteTable(
  "background_job",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    source: text().notNull(),
    title: text().notNull(),
    status: text().$type<BackgroundJobStatus>().notNull(),
    cwd: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    env_json: text({ mode: "json" }).$type<Record<string, string>>(),
    pid: integer(),
    exit_code: integer(),
    error: text(),
    source_message_id: text().$type<MessageID>(),
    source_tool_call_id: text(),
    recovery: text({ mode: "json" }).$type<Record<string, unknown>>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    last_log_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("background_job_session_idx").on(table.session_id),
    index("background_job_status_idx").on(table.status),
    index("background_job_session_status_idx").on(table.session_id, table.status),
  ],
)

export const BackgroundJobLogTable = sqliteTable(
  "background_job_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    job_id: text()
      .notNull()
      .references(() => BackgroundJobTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    stream: text().$type<BackgroundJobStream>().notNull(),
    text: text().notNull(),
    at: integer().notNull(),
  },
  (table) => [
    index("background_job_log_job_seq_idx").on(table.job_id, table.seq),
    index("background_job_log_session_idx").on(table.session_id, table.at),
  ],
)
