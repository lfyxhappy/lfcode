import { and, Database, desc, eq, gte, inArray, lte, sql } from "@/storage"
import type { TxOrDb } from "@/storage/db"
import { ulid } from "ulid"
import { MaintenanceCandidateEventTable, MaintenanceCandidateTable, MaintenanceLockTable, MaintenanceRunTable } from "./maintenance.sql"
import { MemoryRecordTable } from "@/memory/record.sql"

export type MaintenanceStageStatus = "idle" | "running" | "completed" | "failed" | "skipped"
export type MaintenanceRunStatus = "running" | "completed" | "failed"
export type MaintenanceCandidateKind =
  | "skill_update"
  | "skill_create"
  | "command_update"
  | "command_create"
  | "agent_update"
  | "agent_create"
  | "skip"
export type MaintenanceCandidateStatus = "new" | "approved" | "rejected" | "applied" | "stale"

export type MaintenanceRun = {
  id: string
  dayKey: string
  jobKind: "full" | "dream" | "distill"
  triggerSource: "automatic" | "manual" | "scheduler"
  status: MaintenanceRunStatus
  dreamStatus: MaintenanceStageStatus
  distillStatus: MaintenanceStageStatus
  projectIDs: string[]
  summary?: string
  errorExcerpt?: string
  candidateCount: number
  dreamRecordCount: number
  startedAt: number
  finishedAt?: number
  createdAt: number
  updatedAt: number
}

export type MaintenanceCandidate = {
  id: string
  runID: string
  candidateKind: MaintenanceCandidateKind
  targetKind: "skill" | "command" | "agent" | "none"
  targetPath?: string
  evidence: string[]
  confidence: number
  proposedSummary: string
  proposedPatchPreview?: string
  status: MaintenanceCandidateStatus
  appliedAt?: number
  createdAt: number
  updatedAt: number
}

export type MaintenanceCandidateEvent = {
  id: string
  candidateID: string
  action: "approved" | "rejected" | "stale" | "applied" | "apply_failed"
  detail?: Record<string, unknown>
  createdAt: number
}

type RunRow = typeof MaintenanceRunTable.$inferSelect
type CandidateRow = typeof MaintenanceCandidateTable.$inferSelect
type CandidateEventRow = typeof MaintenanceCandidateEventTable.$inferSelect

const LOCK_ID = "host"
const LOCK_DURATION_MS = 30 * 60 * 1000

export function dayKey(now = Date.now()) {
  const value = new Date(now)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

export function toRun(row: RunRow): MaintenanceRun {
  return {
    id: row.id,
    dayKey: row.day_key,
    jobKind: asJobKind(row.job_kind),
    triggerSource: asTriggerSource(row.trigger_source),
    status: asRunStatus(row.status),
    dreamStatus: asStageStatus(row.dream_status),
    distillStatus: asStageStatus(row.distill_status),
    projectIDs: row.project_ids,
    summary: row.summary ?? undefined,
    errorExcerpt: row.error_excerpt ?? undefined,
    candidateCount: row.candidate_count,
    dreamRecordCount: Database.use((db) =>
      Number(
        db
          .select({ count: sql<number>`count(*)` })
          .from(MemoryRecordTable)
          .where(
            and(
              eq(MemoryRecordTable.source, "dream"),
              gte(MemoryRecordTable.time_updated, row.started_at),
              lte(MemoryRecordTable.time_updated, row.finished_at ?? Date.now()),
            ),
          )
          .get()?.count ?? 0,
      ),
    ),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

export function toCandidate(row: CandidateRow): MaintenanceCandidate {
  return {
    id: row.id,
    runID: row.run_id,
    candidateKind: asCandidateKind(row.candidate_kind),
    targetKind: asTargetKind(row.target_kind),
    targetPath: row.target_path ?? undefined,
    evidence: row.evidence,
    confidence: row.confidence,
    proposedSummary: row.proposed_summary,
    proposedPatchPreview: row.proposed_patch_preview ?? undefined,
    status: asCandidateStatus(row.status),
    appliedAt: row.applied_at ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function toCandidateEvent(row: CandidateEventRow): MaintenanceCandidateEvent {
  return {
    id: row.id,
    candidateID: row.candidate_id,
    action: asCandidateEventAction(row.action),
    detail: row.detail ?? undefined,
    createdAt: row.time_created,
  }
}

export function claim(input: {
  jobKind: "full" | "dream" | "distill"
  triggerSource: "automatic" | "manual" | "scheduler"
  projectIDs: string[]
  now?: number
}) {
  const now = input.now ?? Date.now()
  const id = ulid()
  const key = dayKey(now)

  return Database.transaction(
    (db) => {
      const completed = db
        .select({ id: MaintenanceRunTable.id })
        .from(MaintenanceRunTable)
        .where(and(eq(MaintenanceRunTable.day_key, key), eq(MaintenanceRunTable.status, "completed")))
        .get()
      if (input.triggerSource !== "manual" && completed) return { status: "already-completed" as const }

      const active = db
        .select({ id: MaintenanceRunTable.id, started_at: MaintenanceRunTable.started_at })
        .from(MaintenanceRunTable)
        .where(eq(MaintenanceRunTable.status, "running"))
        .orderBy(desc(MaintenanceRunTable.started_at))
        .get()
      if (active && active.started_at + LOCK_DURATION_MS > now) return { status: "already-running" as const, runID: active.id }
      if (active) {
        db
          .update(MaintenanceRunTable)
          .set({
            status: "failed",
            error_excerpt: "Maintenance runner expired before completion.",
            finished_at: now,
            time_updated: now,
          })
          .where(eq(MaintenanceRunTable.id, active.id))
          .run()
        db.delete(MaintenanceLockTable).where(eq(MaintenanceLockTable.owner_run_id, active.id)).run()
      }

      const lock = db.select().from(MaintenanceLockTable).where(eq(MaintenanceLockTable.id, LOCK_ID)).get()
      if (lock && lock.expires_at > now) return { status: "locked" as const, runID: lock.owner_run_id }

      if (lock) {
        db
          .update(MaintenanceLockTable)
          .set({ owner_run_id: id, expires_at: now + LOCK_DURATION_MS, time_updated: now })
          .where(eq(MaintenanceLockTable.id, LOCK_ID))
          .run()
      } else {
        db.insert(MaintenanceLockTable)
          .values({ id: LOCK_ID, owner_run_id: id, expires_at: now + LOCK_DURATION_MS, time_created: now, time_updated: now })
          .run()
      }

      db.insert(MaintenanceRunTable)
        .values({
          id,
          day_key: key,
          job_kind: input.jobKind,
          trigger_source: input.triggerSource,
          status: "running",
          dream_status: input.jobKind === "distill" ? "skipped" : "idle",
          distill_status: input.jobKind === "dream" ? "skipped" : "idle",
          project_ids: input.projectIDs,
          candidate_count: 0,
          started_at: now,
          time_created: now,
          time_updated: now,
        })
        .run()

      const row = db.select().from(MaintenanceRunTable).where(eq(MaintenanceRunTable.id, id)).get()
      if (!row) throw new Error("Failed to create maintenance run")
      return { status: "claimed" as const, run: toRun(row) }
    },
    { behavior: "immediate" },
  )
}

export function updateStage(input: {
  runID: string
  stage: "dream" | "distill"
  status: Exclude<MaintenanceStageStatus, "idle">
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .update(MaintenanceRunTable)
      .set({ [input.stage === "dream" ? "dream_status" : "distill_status"]: input.status, time_updated: now })
      .where(eq(MaintenanceRunTable.id, input.runID))
      .run(),
  )
}

export function complete(input: {
  runID: string
  status: "completed" | "failed"
  summary?: string
  errorExcerpt?: string
}) {
  const now = Date.now()
  return Database.transaction(
    (db) => {
      const count = db
        .select({ count: sql<number>`count(*)` })
        .from(MaintenanceCandidateTable)
        .where(eq(MaintenanceCandidateTable.run_id, input.runID))
        .get()?.count ?? 0
      db
        .update(MaintenanceRunTable)
        .set({
          status: input.status,
          summary: input.summary ?? null,
          error_excerpt: input.errorExcerpt ?? null,
          candidate_count: Number(count),
          finished_at: now,
          time_updated: now,
        })
        .where(eq(MaintenanceRunTable.id, input.runID))
        .run()
      db.delete(MaintenanceLockTable).where(eq(MaintenanceLockTable.owner_run_id, input.runID)).run()
    },
    { behavior: "immediate" },
  )
}

export function fail(runID: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  complete({ runID, status: "failed", errorExcerpt: message.slice(0, 600) })
}

export function insertCandidates(runID: string, candidates: Omit<MaintenanceCandidate, "id" | "runID" | "status" | "appliedAt" | "createdAt" | "updatedAt">[]) {
  if (candidates.length === 0) return []
  const now = Date.now()
  const rows = candidates.map((candidate) => ({
    id: ulid(),
    run_id: runID,
    candidate_kind: candidate.candidateKind,
    target_kind: candidate.targetKind,
    target_path: candidate.targetPath,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    proposed_summary: candidate.proposedSummary,
    proposed_patch_preview: candidate.proposedPatchPreview,
    status: "new" as const,
    time_created: now,
    time_updated: now,
  }))
  Database.use((db) => db.insert(MaintenanceCandidateTable).values(rows).run())
  return rows.map((row) => row.id)
}

export function listRuns(limit = 20) {
  return Database.use((db) => db.select().from(MaintenanceRunTable).orderBy(desc(MaintenanceRunTable.started_at)).limit(limit).all()).map(toRun)
}

export function listCandidates(input?: { statuses?: MaintenanceCandidateStatus[]; limit?: number }) {
  return Database.use((db) => {
    const query = db.select().from(MaintenanceCandidateTable).orderBy(desc(MaintenanceCandidateTable.time_created))
    const filtered = input?.statuses?.length ? query.where(inArray(MaintenanceCandidateTable.status, input.statuses)) : query
    return filtered.limit(input?.limit ?? 100).all()
  }).map(toCandidate)
}

export function updateCandidateStatus(input: { id: string; status: "approved" | "rejected" | "stale" }) {
  const now = Date.now()
  return Database.transaction(
    (db) => {
      const candidate = db.select().from(MaintenanceCandidateTable).where(eq(MaintenanceCandidateTable.id, input.id)).get()
      if (!candidate) throw new Error("Maintenance candidate was not found")
      if (candidate.status === "applied") throw new Error("An applied maintenance candidate cannot be changed")
      db
        .update(MaintenanceCandidateTable)
        .set({ status: input.status, time_updated: now })
        .where(eq(MaintenanceCandidateTable.id, input.id))
        .run()
      insertCandidateEvent(db, { candidateID: input.id, action: input.status, time: now })
      const updated = db.select().from(MaintenanceCandidateTable).where(eq(MaintenanceCandidateTable.id, input.id)).get()
      if (!updated) throw new Error("Maintenance candidate update was not persisted")
      return toCandidate(updated)
    },
    { behavior: "immediate" },
  )
}

export function getCandidate(id: string) {
  return Database.use((db) => {
    const row = db.select().from(MaintenanceCandidateTable).where(eq(MaintenanceCandidateTable.id, id)).get()
    return row ? toCandidate(row) : undefined
  })
}

export function listCandidateHistory(candidateID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(MaintenanceCandidateEventTable)
      .where(eq(MaintenanceCandidateEventTable.candidate_id, candidateID))
      .orderBy(desc(MaintenanceCandidateEventTable.time_created))
      .all()
      .map(toCandidateEvent),
  )
}

export function markCandidateApplied(input: { id: string; detail: Record<string, unknown> }) {
  const now = Date.now()
  return Database.transaction(
    (db) => {
      const candidate = db.select().from(MaintenanceCandidateTable).where(eq(MaintenanceCandidateTable.id, input.id)).get()
      if (!candidate) throw new Error("Maintenance candidate was not found")
      if (candidate.status !== "approved") throw new Error("Only approved maintenance candidates can be applied")
      db
        .update(MaintenanceCandidateTable)
        .set({ status: "applied", applied_at: now, time_updated: now })
        .where(eq(MaintenanceCandidateTable.id, input.id))
        .run()
      insertCandidateEvent(db, { candidateID: input.id, action: "applied", detail: input.detail, time: now })
      const updated = db.select().from(MaintenanceCandidateTable).where(eq(MaintenanceCandidateTable.id, input.id)).get()
      if (!updated) throw new Error("Maintenance candidate apply was not persisted")
      return toCandidate(updated)
    },
    { behavior: "immediate" },
  )
}

export function markCandidateApplyFailed(input: { id: string; error: string }) {
  Database.use((db) =>
    insertCandidateEvent(db, {
      candidateID: input.id,
      action: "apply_failed",
      detail: { error: input.error.slice(0, 600) },
      time: Date.now(),
    }),
  )
}

export function status() {
  const latest = listRuns(1)[0]
  const pending = Database.use((db) =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(MaintenanceCandidateTable)
      .where(eq(MaintenanceCandidateTable.status, "new"))
      .get()?.count ?? 0,
  )
  const running = Database.use((db) =>
    db
      .select({ id: MaintenanceRunTable.id })
      .from(MaintenanceRunTable)
      .where(eq(MaintenanceRunTable.status, "running"))
      .get(),
  )
  return {
    status: running ? "running" : latest?.status === "failed" ? "failed" : pending > 0 ? "pending-review" : "healthy",
    latest,
    pendingCandidates: Number(pending),
  } as const
}

function asJobKind(value: string): MaintenanceRun["jobKind"] {
  return value === "dream" || value === "distill" ? value : "full"
}

function asTriggerSource(value: string): MaintenanceRun["triggerSource"] {
  return value === "manual" || value === "scheduler" ? value : "automatic"
}

function asRunStatus(value: string): MaintenanceRunStatus {
  return value === "completed" || value === "failed" ? value : "running"
}

function asStageStatus(value: string): MaintenanceStageStatus {
  return ["idle", "running", "completed", "failed", "skipped"].includes(value)
    ? (value as MaintenanceStageStatus)
    : "idle"
}

function asCandidateKind(value: string): MaintenanceCandidateKind {
  return ["skill_update", "skill_create", "command_update", "command_create", "agent_update", "agent_create", "skip"].includes(value)
    ? (value as MaintenanceCandidateKind)
    : "skip"
}

function asTargetKind(value: string): MaintenanceCandidate["targetKind"] {
  return value === "skill" || value === "command" || value === "agent" ? value : "none"
}

function asCandidateStatus(value: string): MaintenanceCandidateStatus {
  return ["new", "approved", "rejected", "applied", "stale"].includes(value)
    ? (value as MaintenanceCandidateStatus)
    : "new"
}

function asCandidateEventAction(value: string): MaintenanceCandidateEvent["action"] {
  return ["approved", "rejected", "stale", "applied", "apply_failed"].includes(value)
    ? (value as MaintenanceCandidateEvent["action"])
    : "apply_failed"
}

function insertCandidateEvent(
  db: TxOrDb,
  input: { candidateID: string; action: MaintenanceCandidateEvent["action"]; detail?: Record<string, unknown>; time: number },
) {
  db
    .insert(MaintenanceCandidateEventTable)
    .values({
      id: ulid(),
      candidate_id: input.candidateID,
      action: input.action,
      detail: input.detail,
      time_created: input.time,
    })
    .run()
}
