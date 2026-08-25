import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { AutomationModel, AutomationSchedule, AutomationTarget } from "./schema"

export type ScheduledTaskRunStatus = "queued" | "running" | "waiting_for_session" | "awaiting_user" | "completed" | "failed" | "cancelled"

export const ScheduledTaskTable = sqliteTable(
  "scheduled_task",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    schedule: text({ mode: "json" }).$type<AutomationSchedule>().notNull(),
    target: text({ mode: "json" }).$type<AutomationTarget>().notNull(),
    message: text().notNull(),
    agent: text().notNull(),
    model: text({ mode: "json" }).$type<AutomationModel>(),
    permission_mode: text().notNull(),
    timezone: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull(),
    notifications: text().notNull(),
    source_session_id: text(),
    next_run_at: integer(),
    last_run_at: integer(),
    deleted_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("scheduled_task_due_idx").on(table.enabled, table.next_run_at),
    index("scheduled_task_source_session_idx").on(table.source_session_id),
    index("scheduled_task_deleted_idx").on(table.deleted_at),
  ],
)

export const ScheduledTaskSettingsTable = sqliteTable("scheduled_task_settings", {
  id: text().primaryKey(),
  concurrency: integer().notNull(),
  ...Timestamps,
})

export const ScheduledTaskRunTable = sqliteTable(
  "scheduled_task_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => ScheduledTaskTable.id, { onDelete: "cascade" }),
    status: text().$type<ScheduledTaskRunStatus>().notNull(),
    trigger: text().notNull(),
    scheduled_for: integer().notNull(),
    late: integer({ mode: "boolean" }).notNull(),
    attempt: integer().notNull(),
    session_id: text(),
    lease_owner: text(),
    lease_expires_at: integer(),
    result: text(),
    error: text(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("scheduled_task_run_task_scheduled_unique").on(table.task_id, table.scheduled_for),
    index("scheduled_task_run_task_created_idx").on(table.task_id, table.time_created),
    index("scheduled_task_run_status_scheduled_idx").on(table.status, table.scheduled_for),
    index("scheduled_task_run_session_idx").on(table.session_id),
    index("scheduled_task_run_lease_idx").on(table.status, table.lease_expires_at),
  ],
)
