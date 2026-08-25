import { integer, text, sqliteTable } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import type { PermissionMode } from "./index"

export const ClaudeCodeSessionTable = sqliteTable("claude_code_session", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  claude_session_id: text().notNull().unique(),
  directory: text().notNull(),
  can_resume: integer({ mode: "boolean" }).notNull().default(false),
  permission_mode: text().$type<PermissionMode>().notNull().default("auto"),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
