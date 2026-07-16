import { and, asc, desc, eq, gt } from "../storage"
import { Database } from "../storage"
import { BackgroundJobLogTable, BackgroundJobTable, type BackgroundJobStatus, type BackgroundJobStream } from "./background-job.sql"
import type { SessionID, MessageID } from "../session/schema"

export type BackgroundJobSummary = {
  id: string
  sessionID: SessionID
  kind: string
  source: string
  title: string
  status: BackgroundJobStatus
  cwd: string
  payload: Record<string, unknown>
  env?: Record<string, string>
  pid?: number
  exitCode?: number
  error?: string
  sourceMessageID?: MessageID
  sourceToolCallID?: string
  recovery?: Record<string, unknown>
  metadata?: Record<string, unknown>
  lastLogAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export type BackgroundJobLog = {
  id: number
  jobID: string
  sessionID: SessionID
  seq: number
  stream: BackgroundJobStream
  text: string
  at: number
}

function toSummary(row: typeof BackgroundJobTable.$inferSelect): BackgroundJobSummary {
  return {
    id: row.id,
    sessionID: row.session_id,
    kind: row.kind,
    source: row.source,
    title: row.title,
    status: row.status,
    cwd: row.cwd,
    payload: row.payload,
    ...(row.env_json ? { env: row.env_json } : {}),
    ...(row.pid !== null && row.pid !== undefined ? { pid: row.pid } : {}),
    ...(row.exit_code !== null && row.exit_code !== undefined ? { exitCode: row.exit_code } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.source_message_id ? { sourceMessageID: row.source_message_id } : {}),
    ...(row.source_tool_call_id ? { sourceToolCallID: row.source_tool_call_id } : {}),
    ...(row.recovery ? { recovery: row.recovery } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
    ...(row.last_log_at !== null && row.last_log_at !== undefined ? { lastLogAt: row.last_log_at } : {}),
    ...(row.completed_at !== null && row.completed_at !== undefined ? { completedAt: row.completed_at } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function toLog(row: typeof BackgroundJobLogTable.$inferSelect): BackgroundJobLog {
  return {
    id: row.id,
    jobID: row.job_id,
    sessionID: row.session_id,
    seq: row.seq,
    stream: row.stream,
    text: row.text,
    at: row.at,
  }
}

const recordStart = (input: {
  id: string
  sessionID: SessionID
  kind: string
  source: string
  title: string
  cwd: string
  payload: Record<string, unknown>
  env?: Record<string, string>
  sourceMessageID?: MessageID
  sourceToolCallID?: string
  recovery?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) =>
  Database.transaction((db) => {
    db
      .insert(BackgroundJobTable)
      .values({
        id: input.id,
        session_id: input.sessionID,
        kind: input.kind,
        source: input.source,
        title: input.title,
        status: "running",
        cwd: input.cwd,
        payload: input.payload,
        env_json: input.env ?? null,
        source_message_id: input.sourceMessageID ?? null,
        source_tool_call_id: input.sourceToolCallID ?? null,
        recovery: input.recovery ?? null,
        metadata: input.metadata ?? null,
        pid: null,
        exit_code: null,
        error: null,
        last_log_at: null,
        completed_at: null,
      })
      .onConflictDoUpdate({
        target: BackgroundJobTable.id,
        set: {
          session_id: input.sessionID,
          kind: input.kind,
          source: input.source,
          title: input.title,
          status: "running",
          cwd: input.cwd,
          payload: input.payload,
          env_json: input.env ?? null,
          source_message_id: input.sourceMessageID ?? null,
          source_tool_call_id: input.sourceToolCallID ?? null,
          recovery: input.recovery ?? null,
          metadata: input.metadata ?? null,
          pid: null,
          exit_code: null,
          error: null,
          last_log_at: null,
          completed_at: null,
        },
      })
      .run()
    const row = db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, input.id)).get()
    if (!row) throw new Error(`background job ${input.id} missing after start`)
    return toSummary(row)
  })

const attachProcess = (input: { id: string; pid?: number; recovery?: Record<string, unknown> }) =>
  Database.transaction((db) => {
    db
      .update(BackgroundJobTable)
      .set({
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.recovery !== undefined ? { recovery: input.recovery } : {}),
      })
      .where(eq(BackgroundJobTable.id, input.id))
      .run()
    const row = db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, input.id)).get()
    return row ? toSummary(row) : undefined
  })

const updateRecovery = (input: { id: string; recovery: Record<string, unknown>; pid?: number | null }) =>
  Database.transaction((db) => {
    db
      .update(BackgroundJobTable)
      .set({
        recovery: input.recovery,
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
      })
      .where(eq(BackgroundJobTable.id, input.id))
      .run()
    const row = db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, input.id)).get()
    return row ? toSummary(row) : undefined
  })

const appendLog = (input: {
  jobID: string
  sessionID: SessionID
  seq: number
  stream: BackgroundJobStream
  text: string
  at?: number
}) =>
  Database.transaction((db) => {
    const at = input.at ?? Date.now()
    db
      .insert(BackgroundJobLogTable)
      .values({
        job_id: input.jobID,
        session_id: input.sessionID,
        seq: input.seq,
        stream: input.stream,
        text: input.text,
        at,
      })
      .run()
    db.update(BackgroundJobTable).set({ last_log_at: at }).where(eq(BackgroundJobTable.id, input.jobID)).run()
  })

const recordTerminal = (input: {
  id: string
  status: Exclude<BackgroundJobStatus, "running">
  exitCode?: number
  error?: string
  completedAt?: number
  pid?: number | null
}) =>
  Database.transaction((db) => {
    const completedAt = input.completedAt ?? Date.now()
    db
      .update(BackgroundJobTable)
      .set({
        status: input.status,
        exit_code: input.exitCode ?? null,
        error: input.error ?? null,
        completed_at: completedAt,
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
      })
      .where(eq(BackgroundJobTable.id, input.id))
      .run()
    const row = db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, input.id)).get()
    return row ? toSummary(row) : undefined
  })

const list = (input?: { sessionID?: SessionID; status?: BackgroundJobStatus }) =>
  Database.use((db) => {
    const clauses = []
    if (input?.sessionID) clauses.push(eq(BackgroundJobTable.session_id, input.sessionID))
    if (input?.status) clauses.push(eq(BackgroundJobTable.status, input.status))
    const query = db.select().from(BackgroundJobTable)
    const rows =
      clauses.length === 0
        ? query.orderBy(desc(BackgroundJobTable.time_created)).all()
        : query.where(and(...clauses)).orderBy(desc(BackgroundJobTable.time_created)).all()
    return rows.map(toSummary)
  })

const load = (id: string) =>
  Database.use((db) => {
    const row = db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, id)).get()
    return row ? toSummary(row) : undefined
  })

const listLogs = (input: { jobID: string; afterSeq?: number }) =>
  Database.use((db) => {
    const where =
      input.afterSeq === undefined
        ? eq(BackgroundJobLogTable.job_id, input.jobID)
        : and(eq(BackgroundJobLogTable.job_id, input.jobID), gt(BackgroundJobLogTable.seq, input.afterSeq))
    const rows = db.select().from(BackgroundJobLogTable).where(where).orderBy(asc(BackgroundJobLogTable.seq)).all()
    return rows.map(toLog)
  })

export const BackgroundJobPersistence = {
  recordStart,
  attachProcess,
  updateRecovery,
  appendLog,
  recordTerminal,
  list,
  load,
  listLogs,
}
