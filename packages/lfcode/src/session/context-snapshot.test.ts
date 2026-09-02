import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ProjectTable } from "../project/project.sql"
import { ProjectID } from "../project/schema"
import { Database, eq } from "../storage"
import { saveSnapshot } from "./context-snapshot-store"
import { SessionContextStatusTable } from "./context-status.sql"
import { SessionTable } from "./session.sql"
import { SessionID } from "./schema"
import {
  MAIN_CONTEXT_AGENT_ID,
  isMainContextAgent,
  shouldPersistSnapshot,
  snapshotMetrics,
} from "./context-snapshot"

describe("session context snapshots", () => {
  test("only main-agent snapshots are eligible for persistence", () => {
    expect(isMainContextAgent(undefined)).toBe(true)
    expect(isMainContextAgent(MAIN_CONTEXT_AGENT_ID)).toBe(true)
    expect(isMainContextAgent("tester-1")).toBe(false)
    expect(shouldPersistSnapshot({ agentID: MAIN_CONTEXT_AGENT_ID })).toBe(true)
    expect(shouldPersistSnapshot({ agentID: "tester-1" })).toBe(false)
  })

  test("uses the full context window for every percentage calculation", () => {
    expect(snapshotMetrics(59_000, 1_000_000)).toEqual({
      contextPercentage: 5.9,
      remainingContextTokens: 941_000,
    })
    expect(snapshotMetrics(59_000, null)).toEqual({
      contextPercentage: null,
      remainingContextTokens: null,
    })
  })

  test("marks pre-existing snapshots as unowned during the main-agent migration", () => {
    const db = new BunDatabase(":memory:")
    db.exec(`CREATE TABLE session_context_status (session_id text PRIMARY KEY NOT NULL, active_context_tokens integer NOT NULL DEFAULT 0)`)
    db.exec(`INSERT INTO session_context_status (session_id, active_context_tokens) VALUES ('ses_legacy', 59000)`)
    db.exec(
      readFileSync(
        path.join(import.meta.dir, "../../migration/20260830120000_context_status_main_agent/migration.sql"),
        "utf8",
      ),
    )

    expect(db.query("SELECT agent_id FROM session_context_status WHERE session_id = 'ses_legacy'").get()).toEqual({ agent_id: null })
    db.close()
  })

  test("does not let a late older measurement replace the latest snapshot", () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const projectID = ProjectID.make(`proj_context_snapshot_${tag}`)
    const sessionID = SessionID.make(`ses_context_snapshot_${tag}`)

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: `C:/tmp/${tag}`,
          name: tag,
          sandboxes: [],
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: tag,
          directory: `C:/tmp/${tag}`,
          title: tag,
          version: "v1",
        })
        .run()
    })

    try {
      saveSnapshot({
        sessionID,
        agentID: MAIN_CONTEXT_AGENT_ID,
        activeContextTokens: 20_000,
        contextWindowTokens: 100_000,
        providerID: null,
        modelID: null,
        measuredAt: 200,
        measurementSource: "request_envelope",
      })
      saveSnapshot({
        sessionID,
        agentID: MAIN_CONTEXT_AGENT_ID,
        activeContextTokens: 10_000,
        contextWindowTokens: 100_000,
        providerID: null,
        modelID: null,
        measuredAt: 100,
        measurementSource: "request_envelope",
      })

      const row = Database.use((db) =>
        db
          .select({ active_context_tokens: SessionContextStatusTable.active_context_tokens, measured_at: SessionContextStatusTable.measured_at })
          .from(SessionContextStatusTable)
          .where(eq(SessionContextStatusTable.session_id, sessionID))
          .get(),
      )
      expect(row).toEqual({ active_context_tokens: 20_000, measured_at: 200 })
    } finally {
      Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
      Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    }
  })
})
