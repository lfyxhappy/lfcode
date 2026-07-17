import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const CapabilityGrantTable = sqliteTable(
  "capability_grant",
  {
    id: text().primaryKey(),
    capability: text().notNull(),
    scope: text().notNull(),
    source: text().notNull(),
    expires_at: integer(),
    remaining_budget: integer(),
    revoked: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [
    index("capability_grant_capability_idx").on(table.capability),
    index("capability_grant_active_idx").on(table.revoked, table.expires_at),
  ],
)

export const CapabilityAuditTable = sqliteTable(
  "capability_audit",
  {
    id: text().primaryKey(),
    caller: text().notNull(),
    capability: text().notNull(),
    operation: text().notNull(),
    decision: text().notNull(),
    target: text(),
    project_id: text(),
    session_id: text(),
    message_id: text(),
    reason: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    result: text(),
    rollback: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("capability_audit_capability_idx").on(table.capability, table.time_created),
    index("capability_audit_session_idx").on(table.session_id, table.time_created),
    index("capability_audit_project_idx").on(table.project_id, table.time_created),
  ],
)
