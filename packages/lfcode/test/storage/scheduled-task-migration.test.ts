import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const migrationDir = path.join(import.meta.dirname, "../../migration")
const scheduledTaskMigration = "20260806120000_scheduled_task"
const migrations = readdirSync(migrationDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    sql: readFileSync(path.join(migrationDir, entry.name, "migration.sql"), "utf-8"),
    timestamp: Number(entry.name.split("_")[0]),
    name: entry.name,
  }))
  .sort((a, b) => a.timestamp - b.timestamp)

function tables(sqlite: Database) {
  return sqlite
    .query("select name from sqlite_master where type = 'table' and name in ('scheduled_task', 'scheduled_task_run', 'scheduled_task_settings')")
    .all()
    .map((row) => (row as { name: string }).name)
    .sort()
}

function indexes(sqlite: Database) {
  return sqlite
    .query("select name from sqlite_master where type = 'index' and tbl_name in ('scheduled_task', 'scheduled_task_run')")
    .all()
    .map((row) => (row as { name: string }).name)
    .sort()
}

describe("scheduled task migration", () => {
  test("upgrades an existing database and initializes a fresh one", () => {
    const legacy = new Database(":memory:")
    legacy.exec("pragma foreign_keys = on")
    const legacyDb = drizzle({ client: legacy })
    migrate(legacyDb, migrations.filter((entry) => entry.name < scheduledTaskMigration))
    expect(tables(legacy)).toEqual([])
    migrate(legacyDb, migrations)
    expect(tables(legacy)).toEqual(["scheduled_task", "scheduled_task_run", "scheduled_task_settings"])
    expect(indexes(legacy)).toContain("scheduled_task_run_task_scheduled_unique")
    legacy.close()

    const fresh = new Database(":memory:")
    fresh.exec("pragma foreign_keys = on")
    migrate(drizzle({ client: fresh }), migrations)
    expect(tables(fresh)).toEqual(["scheduled_task", "scheduled_task_run", "scheduled_task_settings"])
    expect(indexes(fresh)).toEqual(
      expect.arrayContaining(["scheduled_task_due_idx", "scheduled_task_run_status_scheduled_idx"]),
    )
    fresh.close()
  })
})
