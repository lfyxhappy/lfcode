import { and, asc, Database, desc, eq, inArray, isNull, lte, sql } from "@/storage"
import type { TxOrDb } from "@/storage/db"
import { ulid } from "ulid"
import {
  AutomationRun,
  AutomationSettings,
  AutomationTask,
  AutomationTaskCreate,
  AutomationTaskUpdate,
  type AutomationRun as AutomationRunType,
  type AutomationSettings as AutomationSettingsType,
  type AutomationRunStatus,
  type AutomationTask as AutomationTaskType,
  type AutomationTaskCreate as AutomationTaskCreateType,
  type AutomationTaskUpdate as AutomationTaskUpdateType,
} from "./schema"
import { isRecurring, nextRunAt, validateSchedule } from "./schedule"
import { ScheduledTaskRunTable, ScheduledTaskSettingsTable, ScheduledTaskTable } from "./scheduled-task.sql"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"

const LATE_THRESHOLD_MS = 60_000
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_CONCURRENCY = 4
const SETTINGS_ID = "global"

type TaskRow = typeof ScheduledTaskTable.$inferSelect
type RunRow = typeof ScheduledTaskRunTable.$inferSelect

export type ClaimedRun = {
  task: AutomationTaskType
  run: AutomationRunType
}

export function toTask(row: TaskRow): AutomationTaskType {
  const schedule = validateSchedule(row.schedule, row.timezone)
  return AutomationTask.parse({
    id: row.id,
    name: row.name,
    schedule,
    target: row.target,
    message: row.message,
    agent: row.agent,
    ...(row.model ? { model: row.model } : {}),
    permissionMode: row.permission_mode,
    timezone: row.timezone,
    enabled: row.enabled,
    status: taskStatus(row, schedule),
    notifications: row.notifications,
    ...(row.source_session_id ? { sourceSessionID: row.source_session_id } : {}),
    ...(row.next_run_at !== null && row.next_run_at !== undefined ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at !== null && row.last_run_at !== undefined ? { lastRunAt: row.last_run_at } : {}),
    ...(row.deleted_at !== null && row.deleted_at !== undefined ? { deletedAt: row.deleted_at } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function toRun(row: RunRow): AutomationRunType {
  return AutomationRun.parse({
    id: row.id,
    taskID: row.task_id,
    status: row.status,
    trigger: row.trigger,
    scheduledFor: row.scheduled_for,
    late: row.late,
    attempt: row.attempt,
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at !== null && row.lease_expires_at !== undefined ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.time_started !== null && row.time_started !== undefined ? { startedAt: row.time_started } : {}),
    ...(row.time_completed !== null && row.time_completed !== undefined ? { finishedAt: row.time_completed } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

export function create(input: AutomationTaskCreateType, now = Date.now()) {
  const task = AutomationTaskCreate.parse(input)
  const schedule = validateSchedule(
    task.schedule.kind === "interval" && task.schedule.anchorAt === undefined
      ? { ...task.schedule, anchorAt: now }
      : task.schedule,
    task.timezone,
  )
  const id = ulid()
  const nextRun = task.enabled ? nextRunAt({ schedule, timezone: task.timezone, after: now }) : undefined
  return Database.transaction(
    (db) => {
      db
        .insert(ScheduledTaskTable)
        .values({
          id,
          name: task.name ?? "定时自动化",
          schedule,
          target: task.target,
          message: task.message,
          agent: task.agent,
          model: task.model ?? null,
          permission_mode: task.permissionMode,
          timezone: task.timezone,
          enabled: task.enabled,
          notifications: task.notifications,
          source_session_id: task.sourceSessionID ?? null,
          next_run_at: nextRun ?? null,
          last_run_at: null,
          deleted_at: null,
          time_created: now,
          time_updated: now,
        })
        .run()
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      if (!row) throw new Error(`Scheduled task ${id} was not persisted`)
      return toTask(row)
    },
    { behavior: "immediate" },
  )
}

export function getSettings(): AutomationSettingsType {
  const row = Database.use((db) =>
    db.select().from(ScheduledTaskSettingsTable).where(eq(ScheduledTaskSettingsTable.id, SETTINGS_ID)).get(),
  )
  return AutomationSettings.parse({ concurrency: row?.concurrency ?? DEFAULT_CONCURRENCY })
}

export function updateSettings(input: AutomationSettingsType, now = Date.now()) {
  const settings = AutomationSettings.parse(input)
  Database.transaction(
    (db) => {
      db
        .insert(ScheduledTaskSettingsTable)
        .values({
          id: SETTINGS_ID,
          concurrency: settings.concurrency,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: ScheduledTaskSettingsTable.id,
          set: { concurrency: settings.concurrency, time_updated: now },
        })
        .run()
    },
    { behavior: "immediate" },
  )
  return settings
}

export function get(id: string, input?: { includeDeleted?: boolean }) {
  const row = Database.use((db) => {
    const where = input?.includeDeleted
      ? eq(ScheduledTaskTable.id, id)
      : and(eq(ScheduledTaskTable.id, id), isNull(ScheduledTaskTable.deleted_at))
    return db.select().from(ScheduledTaskTable).where(where).get()
  })
  return row ? toTask(row) : undefined
}

export function list(input?: { includeDeleted?: boolean; limit?: number }) {
  const rows = Database.use((db) => {
    const query = db.select().from(ScheduledTaskTable)
    const filtered = input?.includeDeleted ? query : query.where(isNull(ScheduledTaskTable.deleted_at))
    return filtered.orderBy(asc(ScheduledTaskTable.next_run_at), desc(ScheduledTaskTable.time_created)).all()
  })
  return rows.slice(0, Math.min(input?.limit ?? 100, 500)).map(toTask)
}

export function update(id: string, patch: AutomationTaskUpdateType, now = Date.now()) {
  const nextPatch = AutomationTaskUpdate.parse(patch)
  return Database.transaction(
    (db) => {
      const current = db
        .select()
        .from(ScheduledTaskTable)
        .where(and(eq(ScheduledTaskTable.id, id), isNull(ScheduledTaskTable.deleted_at)))
        .get()
      if (!current) return undefined

      const requestedSchedule = nextPatch.schedule ?? current.schedule
      const schedule =
        nextPatch.schedule?.kind === "interval" && nextPatch.schedule.anchorAt === undefined
          ? { ...nextPatch.schedule, anchorAt: now }
          : requestedSchedule
      const timezone = nextPatch.timezone ?? current.timezone
      const enabled = nextPatch.enabled ?? current.enabled
      validateSchedule(schedule, timezone)
      const recalculate =
        nextPatch.schedule !== undefined ||
        nextPatch.timezone !== undefined ||
        (nextPatch.enabled === true && !current.enabled)
      const nextRun = !enabled
        ? null
        : recalculate
          ? nextRunAt({ schedule, timezone, after: now }) ?? null
          : current.next_run_at

      db
        .update(ScheduledTaskTable)
        .set({
          name: nextPatch.name ?? current.name,
          schedule,
          target: nextPatch.target ?? current.target,
          message: nextPatch.message ?? current.message,
          agent: nextPatch.agent ?? current.agent,
          model: nextPatch.model === undefined ? current.model : nextPatch.model,
          permission_mode: nextPatch.permissionMode ?? current.permission_mode,
          timezone,
          enabled,
          notifications: nextPatch.notifications ?? current.notifications,
          source_session_id:
            nextPatch.sourceSessionID === undefined ? current.source_session_id : nextPatch.sourceSessionID,
          next_run_at: nextRun,
          time_updated: now,
        })
        .where(eq(ScheduledTaskTable.id, id))
        .run()
      if (nextPatch.enabled === false) cancelPendingRuns(db, id, now, "Cancelled because the task was paused")
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      return row ? toTask(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function pause(id: string, now = Date.now()) {
  return update(id, { enabled: false }, now)
}

export function resume(id: string, now = Date.now()) {
  return update(id, { enabled: true }, now)
}

export function remove(id: string, now = Date.now()) {
  return Database.transaction(
    (db) => {
      const current = db
        .select()
        .from(ScheduledTaskTable)
        .where(and(eq(ScheduledTaskTable.id, id), isNull(ScheduledTaskTable.deleted_at)))
        .get()
      if (!current) return undefined
      db
        .update(ScheduledTaskTable)
        .set({ enabled: false, next_run_at: null, deleted_at: now, time_updated: now })
        .where(eq(ScheduledTaskTable.id, id))
        .run()
      cancelPendingRuns(db, id, now, "Cancelled because the task was deleted")
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      return row ? toTask(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function runNow(taskID: string, now = Date.now()) {
  return Database.transaction(
    (db) => {
      const task = db
        .select()
        .from(ScheduledTaskTable)
        .where(and(eq(ScheduledTaskTable.id, taskID), isNull(ScheduledTaskTable.deleted_at)))
        .get()
      if (!task) return undefined
      const scheduledFor = uniqueScheduledFor(db, taskID, now)
      const id = ulid()
      db
        .insert(ScheduledTaskRunTable)
        .values({
          id,
          task_id: taskID,
          status: "queued",
          trigger: "manual",
          scheduled_for: scheduledFor,
          late: false,
          attempt: 1,
          session_id: null,
          lease_owner: null,
          lease_expires_at: null,
          result: null,
          error: null,
          time_started: null,
          time_completed: null,
          time_created: now,
          time_updated: now,
        })
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function listRuns(taskID: string, input?: { limit?: number }) {
  const limit = Math.max(0, Math.min(input?.limit ?? 100, 500))
  const rows = Database.use((db) =>
    db
      .select()
      .from(ScheduledTaskRunTable)
      .where(eq(ScheduledTaskRunTable.task_id, taskID))
      .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
      .limit(limit)
      .all(),
  )
  return rows.map(toRun)
}

export function listLatestRuns(taskIDs: string[]) {
  if (taskIDs.length === 0) return []
  const rows = Database.use((db) =>
    db
      .select()
      .from(ScheduledTaskRunTable)
      .where(
        and(
          inArray(ScheduledTaskRunTable.task_id, taskIDs),
          sql`NOT EXISTS (
            SELECT 1
            FROM scheduled_task_run AS newer
            WHERE newer.task_id = ${ScheduledTaskRunTable.task_id}
              AND (
                newer.time_created > ${ScheduledTaskRunTable.time_created}
                OR (
                  newer.time_created = ${ScheduledTaskRunTable.time_created}
                  AND newer.id > ${ScheduledTaskRunTable.id}
                )
              )
          )`,
        ),
      )
      .all(),
  )
  return rows.map(toRun)
}

export function cancelRun(taskID: string, runID: string, now = Date.now()) {
  return Database.transaction(
    (db) => {
      const current = db
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(eq(ScheduledTaskRunTable.id, runID), eq(ScheduledTaskRunTable.task_id, taskID)))
        .get()
      if (!current) return undefined
      if (current.status !== "queued" && current.status !== "waiting_for_session") return toRun(current)
      db
        .update(ScheduledTaskRunTable)
        .set({
          status: "cancelled",
          error: "Cancelled before execution",
          lease_owner: null,
          lease_expires_at: null,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(ScheduledTaskRunTable.id, runID))
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, runID)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function claimDue(input?: { now?: number; limit?: number }) {
  const now = input?.now ?? Date.now()
  const candidates = Database.use((db) =>
    db
      .select()
      .from(ScheduledTaskTable)
      .where(
        and(
          eq(ScheduledTaskTable.enabled, true),
          isNull(ScheduledTaskTable.deleted_at),
          lte(ScheduledTaskTable.next_run_at, now),
        ),
      )
      .orderBy(asc(ScheduledTaskTable.next_run_at), asc(ScheduledTaskTable.id))
      .all(),
  )
  return candidates.slice(0, Math.min(input?.limit ?? 100, 500)).flatMap((candidate) => {
    const created = Database.transaction(
      (db) => {
        const task = db
          .select()
          .from(ScheduledTaskTable)
          .where(
            and(
              eq(ScheduledTaskTable.id, candidate.id),
              eq(ScheduledTaskTable.enabled, true),
              isNull(ScheduledTaskTable.deleted_at),
              lte(ScheduledTaskTable.next_run_at, now),
            ),
          )
          .get()
        if (!task || task.next_run_at === null || task.next_run_at === undefined) return undefined
        const schedule = validateSchedule(task.schedule, task.timezone)
        const scheduledFor = task.next_run_at
        const existing = db
          .select()
          .from(ScheduledTaskRunTable)
          .where(and(eq(ScheduledTaskRunTable.task_id, task.id), eq(ScheduledTaskRunTable.scheduled_for, scheduledFor)))
          .get()
        if (existing) return undefined
        const id = ulid()
        db
          .insert(ScheduledTaskRunTable)
          .values({
            id,
            task_id: task.id,
            status: "queued",
            trigger: "schedule",
            scheduled_for: scheduledFor,
            late: now - scheduledFor >= LATE_THRESHOLD_MS,
            attempt: 1,
            session_id: null,
            lease_owner: null,
            lease_expires_at: null,
            result: null,
            error: null,
            time_started: null,
            time_completed: null,
            time_created: now,
            time_updated: now,
          })
          .run()
        db
          .update(ScheduledTaskTable)
          .set({
            next_run_at: isRecurring(schedule) ? nextRunAt({ schedule, timezone: task.timezone, after: now }) ?? null : null,
            last_run_at: now,
            time_updated: now,
          })
          .where(eq(ScheduledTaskTable.id, task.id))
          .run()
        const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, id)).get()
        return row ? toRun(row) : undefined
      },
      { behavior: "immediate" },
    )
    return created ? [created] : []
  })
}

export function claimNextRun(input: { owner: string; now?: number; leaseMs?: number }) {
  const now = input.now ?? Date.now()
  const leaseExpiresAt = now + (input.leaseMs ?? 5 * 60 * 1000)
  return Database.transaction(
    (db) => {
      const candidates = db
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.status, "queued"))
        .orderBy(asc(ScheduledTaskRunTable.scheduled_for), asc(ScheduledTaskRunTable.time_created), asc(ScheduledTaskRunTable.id))
        .all()
      for (const candidate of candidates) {
        const task = db
          .select()
          .from(ScheduledTaskTable)
          .where(and(eq(ScheduledTaskTable.id, candidate.task_id), isNull(ScheduledTaskTable.deleted_at)))
          .get()
        // Manual runs are explicit user requests and must still execute while a
        // task is paused. Scheduled runs remain cancelled until the task is
        // resumed.
        if (!task || (!task.enabled && candidate.trigger !== "manual")) {
          db
            .update(ScheduledTaskRunTable)
            .set({
              status: "cancelled",
              error: "Cancelled because the task is unavailable",
              time_completed: now,
              time_updated: now,
            })
            .where(eq(ScheduledTaskRunTable.id, candidate.id))
            .run()
          continue
        }
        if (task.target.kind === "session" && hasActiveSessionRun(db, task.target.sessionID, candidate.id)) continue
        db
          .update(ScheduledTaskRunTable)
          .set({
            status: "running",
            lease_owner: input.owner,
            lease_expires_at: leaseExpiresAt,
            time_started: candidate.time_started ?? now,
            time_updated: now,
          })
          .where(and(eq(ScheduledTaskRunTable.id, candidate.id), eq(ScheduledTaskRunTable.status, "queued")))
          .run()
        const run = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, candidate.id)).get()
        if (!run || run.status !== "running" || run.lease_owner !== input.owner) continue
        return { task: toTask(task), run: toRun(run) } satisfies ClaimedRun
      }
      return undefined
    },
    { behavior: "immediate" },
  )
}

export function renewLease(input: { id: string; owner: string; attempt?: number; now?: number; leaseMs?: number }) {
  // A lease renewal without the attempt that was claimed is not attributable
  // to a worker. Reject it rather than allowing a restarted worker that reused
  // the same owner string to extend a newer attempt's lease.
  const attempt = input.attempt
  if (attempt === undefined) return undefined
  const now = input.now ?? Date.now()
  const expiresAt = now + (input.leaseMs ?? 5 * 60 * 1000)
  return Database.transaction(
    (db) => {
      const current = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      if (!current || current.status !== "running" || !matchesClaim(current, { owner: input.owner, attempt })) return undefined
      db
        .update(ScheduledTaskRunTable)
        .set({ lease_expires_at: expiresAt, time_updated: now })
        .where(
          and(
            eq(ScheduledTaskRunTable.id, input.id),
            eq(ScheduledTaskRunTable.status, "running"),
            eq(ScheduledTaskRunTable.lease_owner, input.owner),
            eq(ScheduledTaskRunTable.attempt, attempt),
          ),
        )
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function completeRun(input: {
  id: string
  status: Extract<AutomationRunStatus, "completed" | "failed" | "cancelled">
  owner?: string
  attempt?: number
  sessionID?: string
  result?: string
  error?: string
  now?: number
}) {
  const now = input.now ?? Date.now()
  return Database.transaction(
    (db) => {
      const current = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      if (!current || !matchesClaim(current, input)) return undefined
      if (current.status !== "running" && current.status !== "waiting_for_session" && current.status !== "awaiting_user") return toRun(current)
      db
        .update(ScheduledTaskRunTable)
        .set({
          status: input.status,
          session_id: input.sessionID ?? current.session_id,
          result: input.result ?? null,
          error: input.error ?? null,
          lease_owner: null,
          lease_expires_at: null,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(ScheduledTaskRunTable.id, input.id))
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function setRunSession(input: { id: string; owner?: string; attempt?: number; sessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.transaction(
    (db) => {
      const current = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      if (!current || !matchesClaim(current, input)) return undefined
      if (current.status !== "running") return toRun(current)
      db
        .update(ScheduledTaskRunTable)
        .set({ session_id: input.sessionID, time_updated: now })
        .where(eq(ScheduledTaskRunTable.id, input.id))
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function markWaitingForSession(input: { id: string; owner?: string; attempt?: number; sessionID: string; now?: number }) {
  return markBlocked({ ...input, status: "waiting_for_session" })
}

export function markAwaitingUser(input: { id: string; owner?: string; attempt?: number; sessionID?: string; now?: number }) {
  return markBlocked({ ...input, status: "awaiting_user" })
}

export function listWaitingForSession(sessionID?: string, limit = 100) {
  const rows = Database.use((db) => {
    const where = sessionID
      ? and(eq(ScheduledTaskRunTable.status, "waiting_for_session"), eq(ScheduledTaskRunTable.session_id, sessionID))
      : eq(ScheduledTaskRunTable.status, "waiting_for_session")
    return db
      .select()
      .from(ScheduledTaskRunTable)
      .where(where)
      .orderBy(asc(ScheduledTaskRunTable.scheduled_for), asc(ScheduledTaskRunTable.time_created))
      .all()
  })
  return rows.slice(0, Math.min(limit, 500)).map(toRun)
}

export function requeueRun(id: string, now = Date.now()) {
  return Database.transaction(
    (db) => {
      const current = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, id)).get()
      if (!current || current.status !== "waiting_for_session") return current ? toRun(current) : undefined
      db
        .update(ScheduledTaskRunTable)
        .set({ status: "queued", lease_owner: null, lease_expires_at: null, time_updated: now })
        .where(and(eq(ScheduledTaskRunTable.id, id), eq(ScheduledTaskRunTable.status, "waiting_for_session")))
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

export function recover(input?: { now?: number; force?: boolean }) {
  const now = input?.now ?? Date.now()
  return Database.transaction(
    (db) => {
      const stale = db
        .select()
        .from(ScheduledTaskRunTable)
        .where(inArray(ScheduledTaskRunTable.status, ["running", "awaiting_user"]))
        .all()
        .filter(
          (run) =>
            run.status === "awaiting_user" || input?.force || run.lease_expires_at === null || run.lease_expires_at <= now,
        )
      for (const run of stale) {
        db
          .update(ScheduledTaskRunTable)
          .set({
            status: "queued",
            trigger: "recovery",
            attempt: run.attempt + 1,
            error:
              run.status === "awaiting_user"
                ? "Recovered after restart while awaiting user approval"
                : "Recovered after the scheduler lease expired",
            lease_owner: null,
            lease_expires_at: null,
            time_updated: now,
          })
          .where(eq(ScheduledTaskRunTable.id, run.id))
          .run()
      }
      const deletedBefore = now - RETENTION_MS
      const retired = db
        .select({ id: ScheduledTaskTable.id })
        .from(ScheduledTaskTable)
        .where(lte(ScheduledTaskTable.deleted_at, deletedBefore))
        .all()
      if (retired.length > 0) db.delete(ScheduledTaskTable).where(inArray(ScheduledTaskTable.id, retired.map((task) => task.id))).run()
      return { requeued: stale.length, purged: retired.length }
    },
    { behavior: "immediate" },
  )
}

export function resolveSession(sessionID: string) {
  const session = Database.use((db) =>
    db
      .select({ directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.id, SessionID.make(sessionID)))
      .get(),
  )
  if (!session) return
  const run = Database.use((db) =>
    db
      .select()
      .from(ScheduledTaskRunTable)
      .where(eq(ScheduledTaskRunTable.session_id, sessionID))
      .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
      .get(),
  )
  if (run) {
    const task = get(run.task_id, { includeDeleted: true })
    if (task) return { task, run: toRun(run), directory: session.directory }
  }
  const task = list({ includeDeleted: true, limit: 500 }).find(
    (item) => item.target.kind === "session" && item.target.sessionID === sessionID,
  )
  return task ? { task, directory: session.directory } : undefined
}

function taskStatus(row: TaskRow, schedule: AutomationTaskType["schedule"]): AutomationTaskType["status"] {
  if (row.deleted_at !== null && row.deleted_at !== undefined) return "deleted"
  if (!row.enabled) return "paused"
  if (schedule.kind === "once" && row.next_run_at === null && row.last_run_at !== null) return "completed"
  return "active"
}

function uniqueScheduledFor(db: TxOrDb, taskID: string, now: number) {
  let candidate = now
  while (
    db
      .select({ id: ScheduledTaskRunTable.id })
      .from(ScheduledTaskRunTable)
      .where(and(eq(ScheduledTaskRunTable.task_id, taskID), eq(ScheduledTaskRunTable.scheduled_for, candidate)))
      .get()
  ) {
    candidate++
  }
  return candidate
}

function cancelPendingRuns(
  db: TxOrDb,
  taskID: string,
  now: number,
  error: string,
) {
  db
    .update(ScheduledTaskRunTable)
    .set({
      status: "cancelled",
      error,
      lease_owner: null,
      lease_expires_at: null,
      time_completed: now,
      time_updated: now,
    })
    .where(
      and(
        eq(ScheduledTaskRunTable.task_id, taskID),
        inArray(ScheduledTaskRunTable.status, ["queued", "waiting_for_session"]),
      ),
    )
    .run()
}

function markBlocked(input: {
  id: string
  owner?: string
  attempt?: number
  sessionID?: string
  status: "waiting_for_session" | "awaiting_user"
  now?: number
}) {
  const now = input.now ?? Date.now()
  return Database.transaction(
    (db) => {
      const current = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      if (!current || current.status !== "running" || !matchesClaim(current, input)) return undefined
      db
        .update(ScheduledTaskRunTable)
        .set({
          status: input.status,
          session_id: input.sessionID ?? current.session_id,
          lease_owner: null,
          lease_expires_at: null,
          time_updated: now,
        })
        .where(eq(ScheduledTaskRunTable.id, input.id))
        .run()
      const row = db.select().from(ScheduledTaskRunTable).where(eq(ScheduledTaskRunTable.id, input.id)).get()
      return row ? toRun(row) : undefined
    },
    { behavior: "immediate" },
  )
}

function matchesClaim(current: RunRow, input: { owner?: string; attempt?: number }) {
  // Every worker-side mutation must carry both fencing dimensions. Keeping
  // either field optional at the type boundary is useful for old callers, but
  // an unscoped mutation must be rejected at runtime.
  if (input.owner === undefined || input.attempt === undefined) return false
  return current.attempt === input.attempt && current.lease_owner === input.owner
}

function hasActiveSessionRun(db: TxOrDb, sessionID: string, exceptID: string) {
  const active = db
    .select()
    .from(ScheduledTaskRunTable)
    .where(inArray(ScheduledTaskRunTable.status, ["running", "waiting_for_session", "awaiting_user"]))
    .all()
  return active.some((run) => {
    if (run.id === exceptID) return false
    const task = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, run.task_id)).get()
    return task?.target.kind === "session" && task.target.sessionID === sessionID
  })
}

export const Persistence = {
  create,
  getSettings,
  updateSettings,
  get,
  list,
  update,
  pause,
  resume,
  remove,
  runNow,
  listRuns,
  listLatestRuns,
  cancelRun,
  claimDue,
  claimNextRun,
  renewLease,
  completeRun,
  markWaitingForSession,
  markAwaitingUser,
  setRunSession,
  listWaitingForSession,
  requeueRun,
  recover,
  resolveSession,
}
