import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const HookDefinitionTable = sqliteTable("hook_definition", {
  id: text().primaryKey(), name: text().notNull(), description: text().notNull(), enabled: integer({ mode: "boolean" }).notNull().default(true),
  scope: text().notNull(), project_id: text(), session_id: text(), owner_session_id: text(), events: text({ mode: "json" }).notNull(), matcher: text().notNull(), handler: text({ mode: "json" }).notNull(),
  lifetime: text().notNull(), expiry: text({ mode: "json" }), remaining_runs: integer(), expired_at: integer(), source: text().notNull(), ...Timestamps,
}, (table) => [index("hook_definition_scope_idx").on(table.scope, table.project_id, table.session_id), index("hook_definition_enabled_idx").on(table.enabled, table.time_created)])

export const HookRunTable = sqliteTable("hook_run", {
  id: text().primaryKey(), hook_id: text().notNull().references(() => HookDefinitionTable.id, { onDelete: "cascade" }), session_id: text(), event: text().notNull(), status: text().notNull(), duration_ms: integer().notNull(), summary: text().notNull(), input: text({ mode: "json" }).notNull(), output: text({ mode: "json" }).notNull(), time_created: integer().notNull(),
}, (table) => [index("hook_run_hook_time_idx").on(table.hook_id, table.time_created), index("hook_run_session_time_idx").on(table.session_id, table.time_created)])
