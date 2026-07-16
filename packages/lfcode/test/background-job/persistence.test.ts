import { describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { BackgroundJobLogTable, BackgroundJobTable } from "../../src/background-job/background-job.sql"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"

function seedSession(tag: string) {
  const projectID = ProjectID.make(`proj_${tag}`)
  const sessionID = SessionID.make(`ses_${tag}`)
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: `C:/tmp/${tag}`,
        name: tag,
        sandboxes: [],
      })
      .onConflictDoNothing()
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
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

describe("BackgroundJobPersistence", () => {
  test("records start and terminal state", () => {
    const tag = `${Date.now()}_start`
    const sessionID = seedSession(tag)
    const jobID = `job_${tag}`

    const started = BackgroundJobPersistence.recordStart({
      id: jobID,
      sessionID,
      kind: "python",
      source: "tool",
      title: "Run python task",
      cwd: "C:/tmp/run",
      payload: { code: "print('hi')" },
      env: { FOO: "bar" },
      sourceToolCallID: "call_1",
      recovery: { runtime: "managed-python" },
      metadata: { background: true },
    })

    expect(started.status).toBe("running")
    expect(started.kind).toBe("python")
    expect(started.env).toEqual({ FOO: "bar" })

    const finished = BackgroundJobPersistence.recordTerminal({
      id: jobID,
      status: "completed",
      exitCode: 0,
      pid: 1234,
    })

    expect(finished?.status).toBe("completed")
    expect(finished?.exitCode).toBe(0)
    expect(finished?.pid).toBe(1234)

    const row = Database.use((db) => db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, jobID)).get())
    expect(row?.status).toBe("completed")
    expect(row?.exit_code).toBe(0)
  })

  test("appends ordered logs and updates last_log_at", () => {
    const tag = `${Date.now()}_logs`
    const sessionID = seedSession(tag)
    const jobID = `job_${tag}`

    BackgroundJobPersistence.recordStart({
      id: jobID,
      sessionID,
      kind: "shell",
      source: "tool",
      title: "Run shell task",
      cwd: "C:/tmp/logs",
      payload: { command: "dir" },
    })

    BackgroundJobPersistence.appendLog({
      jobID,
      sessionID,
      seq: 1,
      stream: "stdout",
      text: "line 1",
      at: 100,
    })
    BackgroundJobPersistence.appendLog({
      jobID,
      sessionID,
      seq: 2,
      stream: "stderr",
      text: "line 2",
      at: 200,
    })

    const logs = BackgroundJobPersistence.listLogs({ jobID })
    expect(logs.map((item) => [item.seq, item.stream, item.text])).toEqual([
      [1, "stdout", "line 1"],
      [2, "stderr", "line 2"],
    ])

    const afterFirst = BackgroundJobPersistence.listLogs({ jobID, afterSeq: 1 })
    expect(afterFirst.map((item) => item.seq)).toEqual([2])

    const row = Database.use((db) => db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, jobID)).get())
    expect(row?.last_log_at).toBe(200)

    const logRows = Database.use((db) =>
      db.select().from(BackgroundJobLogTable).where(eq(BackgroundJobLogTable.job_id, jobID)).all(),
    )
    expect(logRows).toHaveLength(2)
  })
})
