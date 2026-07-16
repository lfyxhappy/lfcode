import { BackgroundJobPersistence, type BackgroundJobSummary } from "./persistence"
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

export type BackgroundJobCancelResult =
  | {
      ok: false
      code: "not_found"
      message: string
    }
  | {
      ok: true
      code: "already_terminal" | "unmanaged_running" | "cancelled" | "reconciled_missing_process"
      changed: boolean
      message: string
      job: BackgroundJobSummary
    }

export type BackgroundJobReconcileResult =
  | {
      ok: false
      code: "not_found"
      changed: false
      message: string
    }
  | {
      ok: true
      code: "already_terminal" | "unmanaged_running" | "still_running" | "reconciled_missing_process"
      changed: boolean
      message: string
      job: BackgroundJobSummary
    }

function nextLogSeq(jobID: string) {
  return (BackgroundJobPersistence.listLogs({ jobID }).at(-1)?.seq ?? 0) + 1
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError?.code === "EPERM") return true
    if (nodeError?.code === "ESRCH") return false
    throw error
  }
}

function killProcessTree(pid: number) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true,
    })
    if (result.status === 0) return
    const error = new Error(`Failed to terminate process tree rooted at pid ${pid}.`) as NodeJS.ErrnoException
    error.code = processExists(pid) ? "EPERM" : "ESRCH"
    throw error
  }

  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    process.kill(pid, "SIGTERM")
  }
}

function shellManifest(job: BackgroundJobSummary) {
  if (job.kind !== "shell" || !job.recovery) return
  const manifestPath = (job.recovery as Record<string, unknown>).manifestPath
  if (typeof manifestPath !== "string" || !existsSync(manifestPath)) return
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      status?: unknown
      exitCode?: unknown
      error?: unknown
      completedAt?: unknown
    }
    if (
      parsed.status !== "completed" &&
      parsed.status !== "failed" &&
      parsed.status !== "cancelled"
    ) {
      return
    }
    return {
      status: parsed.status,
      ...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      ...(typeof parsed.completedAt === "number" ? { completedAt: parsed.completedAt } : {}),
    } as const
  } catch {
    return
  }
}

export function cancelBackgroundJob(jobID: string, source = "manual"): BackgroundJobCancelResult {
  const job = BackgroundJobPersistence.load(jobID)
  if (!job) {
    return {
      ok: false,
      code: "not_found",
      message: `Background job not found: ${jobID}`,
    }
  }

  if (job.status !== "running") {
    return {
      ok: true,
      code: "already_terminal",
      changed: false,
      message: `Background job ${job.id} is already ${job.status}.`,
      job,
    }
  }

  if (job.pid === undefined) {
    const manifest = shellManifest(job)
    if (manifest) {
      const next =
        BackgroundJobPersistence.recordTerminal({
          id: job.id,
          status: manifest.status,
          ...(manifest.exitCode !== undefined ? { exitCode: manifest.exitCode } : {}),
          ...(manifest.error !== undefined ? { error: manifest.error } : {}),
          ...(manifest.completedAt !== undefined ? { completedAt: manifest.completedAt } : {}),
          pid: null,
        }) ?? job
      return {
        ok: true,
        code: "reconciled_missing_process",
        changed: true,
        message: `Background job ${job.id} had terminal shell background metadata on disk; durable state was updated from the manifest.`,
        job: next,
      }
    }
    return {
      ok: true,
      code: "unmanaged_running",
      changed: false,
      message: `Background job ${job.id} is still marked running but has no tracked pid, so it cannot be cancelled from this host yet.`,
      job,
    }
  }

  const at = Date.now()
  const seq = nextLogSeq(jobID)

  try {
    killProcessTree(job.pid)
    BackgroundJobPersistence.appendLog({
      jobID: job.id,
      sessionID: job.sessionID,
      seq,
      stream: "system",
      text: `Cancellation requested via ${source}; terminated process tree rooted at pid ${job.pid}.`,
      at,
    })
    const next =
      BackgroundJobPersistence.recordTerminal({
        id: job.id,
        status: "cancelled",
        completedAt: at,
        pid: null,
      }) ?? job
    return {
      ok: true,
      code: "cancelled",
      changed: true,
      message: `Cancelled background job ${job.id}.`,
      job: next,
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError?.code !== "ESRCH") throw error
    BackgroundJobPersistence.appendLog({
      jobID: job.id,
      sessionID: job.sessionID,
      seq,
      stream: "system",
      text: `Cancellation requested via ${source}, but pid ${job.pid} no longer exists; durable state was reconciled as cancelled.`,
      at,
    })
    const next =
      BackgroundJobPersistence.recordTerminal({
        id: job.id,
        status: "cancelled",
        completedAt: at,
        pid: null,
        error: "Tracked process was already gone when cancellation was requested.",
      }) ?? job
    return {
      ok: true,
      code: "reconciled_missing_process",
      changed: true,
      message: `Background job ${job.id} had no live process by the time cancellation was requested; durable state was reconciled.`,
      job: next,
    }
  }
}

export function reconcileBackgroundJob(jobID: string, source = "manual"): BackgroundJobReconcileResult {
  const job = BackgroundJobPersistence.load(jobID)
  if (!job) {
    return {
      ok: false,
      code: "not_found",
      changed: false,
      message: `Background job not found: ${jobID}`,
    }
  }

  if (job.status !== "running") {
    return {
      ok: true,
      code: "already_terminal",
      changed: false,
      message: `Background job ${job.id} is already ${job.status}.`,
      job,
    }
  }

  if (job.pid === undefined) {
    return {
      ok: true,
      code: "unmanaged_running",
      changed: false,
      message: `Background job ${job.id} is still marked running but has no tracked pid, so startup reconcile cannot verify it on this host yet.`,
      job,
    }
  }

  if (processExists(job.pid)) {
    return {
      ok: true,
      code: "still_running",
      changed: false,
      message: `Background job ${job.id} is still running on pid ${job.pid}.`,
      job,
    }
  }

  const manifest = shellManifest(job)
  if (manifest) {
    const next =
      BackgroundJobPersistence.recordTerminal({
        id: job.id,
        status: manifest.status,
        ...(manifest.exitCode !== undefined ? { exitCode: manifest.exitCode } : {}),
        ...(manifest.error !== undefined ? { error: manifest.error } : {}),
        ...(manifest.completedAt !== undefined ? { completedAt: manifest.completedAt } : {}),
        pid: null,
      }) ?? job
    return {
      ok: true,
      code: "reconciled_missing_process",
      changed: true,
      message: `Background job ${job.id} had terminal shell background metadata on disk; durable state was updated from the manifest.`,
      job: next,
    }
  }

  const at = Date.now()
  BackgroundJobPersistence.appendLog({
    jobID: job.id,
    sessionID: job.sessionID,
    seq: nextLogSeq(jobID),
    stream: "system",
    text: `Reconcile requested via ${source}; tracked pid ${job.pid} no longer exists, so durable state was marked failed.`,
    at,
  })
  const next =
    BackgroundJobPersistence.recordTerminal({
      id: job.id,
      status: "failed",
      completedAt: at,
      pid: null,
      error: "Tracked process was missing during background-job reconcile.",
    }) ?? job
  return {
    ok: true,
    code: "reconciled_missing_process",
    changed: true,
    message: `Background job ${job.id} had no live process at reconcile time; durable state was marked failed.`,
    job: next,
  }
}

export function reconcileRunningBackgroundJobs(source = "manual", options?: { includeShellJobs?: boolean }) {
  return BackgroundJobPersistence.list({ status: "running" })
    .filter((job) => options?.includeShellJobs !== false || job.kind !== "shell")
    .map((job) => reconcileBackgroundJob(job.id, source))
}
