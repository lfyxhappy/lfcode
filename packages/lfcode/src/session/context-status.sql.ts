import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import type { ProviderID, ModelID } from "../provider/schema"
import type { SessionID } from "./schema"

/** Latest measured request context for a session. This is a snapshot, not a history table. */
export const SessionContextStatusTable = sqliteTable("session_context_status", {
  session_id: text().$type<SessionID>().primaryKey().references(() => SessionTable.id, { onDelete: "cascade" }),
  agent_id: text(),
  active_context_tokens: integer().notNull().default(0),
  context_window_tokens: integer(),
  context_percentage: integer(),
  remaining_context_tokens: integer(),
  provider_id: text().$type<ProviderID>(),
  model_id: text().$type<ModelID>(),
  measured_at: integer().notNull(),
  measurement_source: text().notNull(),
})
