import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const ResearchSettingsTable = sqliteTable("research_settings", {
  project_id: text().primaryKey(),
  browser_search_engine: text(),
  browser_search_url_template: text(),
  ...Timestamps,
})
