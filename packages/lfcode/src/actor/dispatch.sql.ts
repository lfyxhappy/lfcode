import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"
import type { ContextMode, ToolWhitelist } from "./schema"
import type { Snapshot as ResearchDispatchSnapshot } from "@/research/dispatch"

export type ActorDispatchStatus = "queued" | "running" | "interrupted" | "completed" | "failed" | "cancelled"

export const ActorDispatchTable = sqliteTable(
  "actor_dispatch",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    actor_id: text().notNull(),
    parent_actor_id: text(),
    agent: text().notNull(),
    description: text().notNull(),
    status: text().$type<ActorDispatchStatus>().notNull(),
    execution: text().$type<"background">().notNull(),
    context_mode: text().$type<ContextMode>().notNull(),
    model: text({ mode: "json" }).$type<{ providerID: string; modelID: string }>(),
    payload: text({ mode: "json" })
      .$type<{
        parentSessionID?: string
        parentActorID?: string
        agent: string
        task: string
        description: string
        context: ContextMode
        tools: ToolWhitelist
        model?: { providerID: string; modelID: string }
        taskID?: string
        cwd?: string
        parentAgent?: string
        parentModel?: { providerID: string; modelID: string }
        contextRefs?: string[]
        declaredFiles?: string[]
        research?: ResearchDispatchSnapshot
      }>()
      .notNull(),
    context_refs: text({ mode: "json" }).$type<string[]>().notNull(),
    declared_files: text({ mode: "json" }).$type<string[]>().notNull(),
    actual_files: text({ mode: "json" }).$type<string[]>().notNull(),
    write_access: integer({ mode: "boolean" }).notNull(),
    result: text(),
    error: text(),
    unread: integer({ mode: "boolean" }).notNull(),
    acknowledged_at: integer(),
    manual_resume: integer({ mode: "boolean" }).notNull(),
    resumed_from: text(),
    attempt: integer().notNull(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("actor_dispatch_session_created_idx").on(table.session_id, table.time_created),
    index("actor_dispatch_session_status_idx").on(table.session_id, table.status),
    index("actor_dispatch_actor_idx").on(table.session_id, table.actor_id),
    index("actor_dispatch_status_idx").on(table.status),
  ],
)

export const ActorDispatchSettingsTable = sqliteTable("actor_dispatch_settings", {
  id: text().primaryKey(),
  background_concurrency: integer().notNull(),
  ...Timestamps,
})
