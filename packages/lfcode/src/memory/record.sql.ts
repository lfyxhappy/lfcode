import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

/**
 * Canonical memory metadata. Markdown files remain a compatibility projection
 * while legacy writers are migrated incrementally.
 */
export const MemoryRecordTable = sqliteTable(
  "memory_record",
  {
    id: text().primaryKey(),
    layer: text().notNull(),
    scope: text().notNull(),
    scope_id: text().notNull().default(""),
    record_kind: text().notNull(),
    source: text().notNull(),
    authority: text().notNull(),
    freshness: text(),
    search_text: text().notNull(),
    body: text().notNull(),
    summary: text(),
    projection_path: text().unique(),
    import_origin: text(),
    ...Timestamps,
  },
  (table) => [
    index("memory_record_scope_idx").on(table.scope, table.scope_id),
    index("memory_record_layer_idx").on(table.layer),
    index("memory_record_projection_idx").on(table.projection_path),
  ],
)
