import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import type { MessageID, SessionID } from "@/session/schema"

export type ContextReviewStatus = "pending" | "running" | "completed" | "failed" | "consumed" | "expired"

export const ContextReviewTable = sqliteTable(
  "context_review",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    source_user_message_id: text().$type<MessageID>().notNull(),
    source_assistant_message_id: text().$type<MessageID>(),
    consuming_user_message_id: text().$type<MessageID>(),
    reviewer_actor_id: text(),
    status: text().$type<ContextReviewStatus>().notNull(),
    findings: text({ mode: "json" }).$type<unknown>(),
    error: text(),
    time_completed: integer(),
    time_consumed: integer(),
    time_expired: integer(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    uniqueIndex("context_review_source_user_idx").on(table.session_id, table.source_user_message_id),
    index("context_review_session_status_idx").on(table.session_id, table.status),
    index("context_review_session_created_idx").on(table.session_id, table.time_created),
  ],
)
