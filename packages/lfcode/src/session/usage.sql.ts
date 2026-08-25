import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "./schema"

export const UsageFactTable = sqliteTable(
  "usage_fact",
  {
    part_id: text().$type<PartID>().primaryKey(),
    message_id: text().$type<MessageID>().notNull(),
    session_id: text().$type<SessionID>().notNull(),
    project_id: text().$type<ProjectID>().notNull().references(() => ProjectTable.id, { onDelete: "cascade" }),
    time_created: integer().notNull(),
    agent_id: text().notNull(),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    status: text().notNull(),
    input_tokens: integer().notNull().default(0),
    output_tokens: integer().notNull().default(0),
    reasoning_tokens: integer().notNull().default(0),
    cache_read_tokens: integer().notNull().default(0),
    cache_write_tokens: integer().notNull().default(0),
    overhead_tokens: integer().notNull().default(0),
    cost: real().notNull().default(0),
    overhead_cost: real().notNull().default(0),
    duration: integer(),
    ttft: integer(),
    submit_to_first_delta: integer(),
    pre_stream: integer(),
  },
  (table) => [
    index("usage_fact_time_idx").on(table.time_created, table.part_id),
    index("usage_fact_session_time_idx").on(table.session_id, table.time_created, table.part_id),
    index("usage_fact_project_time_idx").on(table.project_id, table.time_created, table.part_id),
    index("usage_fact_provider_model_idx").on(table.provider_id, table.model_id, table.time_created),
    index("usage_fact_status_idx").on(table.status, table.time_created),
  ],
)

export const UsageFactBackfillTable = sqliteTable("usage_fact_backfill", {
  id: integer().primaryKey(),
  cursor_time: integer(),
  cursor_part_id: text(),
  completed: integer().notNull().default(0),
  updated_at: integer().notNull(),
})
