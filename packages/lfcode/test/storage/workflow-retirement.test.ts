import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { cleanupRetiredWorkflowArtifacts } from "../../src/storage/db"

const migrationDir = path.join(import.meta.dirname, "../../migration")
const retirementMigration = "20260804120000_remove_workflow_orchestration"
const migrations = readdirSync(migrationDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    sql: readFileSync(path.join(migrationDir, entry.name, "migration.sql"), "utf-8"),
    timestamp: Number(entry.name.split("_")[0]),
    name: entry.name,
  }))
  .sort((a, b) => a.timestamp - b.timestamp)

const retiredTables = [
  "orchestration_task_event",
  "orchestration_task",
  "orchestration_event",
  "orchestration_node",
  "orchestration_execution",
  "workflow_run",
]

function existingRetiredTables(sqlite: Database) {
  return sqlite
    .query(`select name from sqlite_master where type = 'table' and name in (${retiredTables.map(() => "?").join(",")})`)
    .all(...retiredTables)
    .map((row) => (row as { name: string }).name)
    .sort()
}

describe("workflow retirement", () => {
  test("removes retired tables from existing and fresh databases", () => {
    const legacy = new Database(":memory:")
    legacy.exec("pragma foreign_keys = on")
    const legacyDb = drizzle({ client: legacy })
    migrate(legacyDb, migrations.filter((entry) => entry.name < retirementMigration))
    expect(existingRetiredTables(legacy)).toEqual([...retiredTables].sort())
    migrate(legacyDb, migrations)
    expect(existingRetiredTables(legacy)).toEqual([])
    legacy.close()

    const fresh = new Database(":memory:")
    fresh.exec("pragma foreign_keys = on")
    migrate(drizzle({ client: fresh }), migrations)
    expect(existingRetiredTables(fresh)).toEqual([])
    fresh.close()
  })

  test("removes only retired workflow artifacts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lfcode-workflow-retirement-"))
    try {
      writeFileSync(path.join(dir, "wf_alpha.js"), "legacy")
      writeFileSync(path.join(dir, "wf_alpha.jsonl"), "legacy")
      writeFileSync(path.join(dir, "wf_bad-name.js"), "keep")
      writeFileSync(path.join(dir, "wf_alpha.txt"), "keep")
      writeFileSync(path.join(dir, "notes.jsonl"), "keep")
      mkdirSync(path.join(dir, "wf_nested"))

      expect(cleanupRetiredWorkflowArtifacts(dir).sort()).toEqual(["wf_alpha.js", "wf_alpha.jsonl"])
      expect(existsSync(path.join(dir, "wf_alpha.js"))).toBe(false)
      expect(existsSync(path.join(dir, "wf_alpha.jsonl"))).toBe(false)
      expect(existsSync(path.join(dir, "wf_bad-name.js"))).toBe(true)
      expect(existsSync(path.join(dir, "wf_alpha.txt"))).toBe(true)
      expect(existsSync(path.join(dir, "notes.jsonl"))).toBe(true)
      expect(existsSync(path.join(dir, "wf_nested"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
