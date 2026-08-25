import { ulid } from "ulid"
import { AutomationRunExecution, type AutomationRun as AutomationRunType, type AutomationTask as AutomationTaskType } from "./schema"
import { Persistence, type ClaimedRun } from "./persistence"
import { Log } from "@/util"

const DEFAULT_INTERVAL_MS = 1_000
const DEFAULT_CONCURRENCY = 4
const DEFAULT_LEASE_MS = 5 * 60 * 1_000
const log = Log.create({ service: "scheduled-task-scheduler" })

export type SchedulerOptions = {
  execute: (task: AutomationTaskType, run: AutomationRunType) => Promise<void | { status?: "completed" | "waiting_for_session" | "awaiting_user"; sessionID?: string; result?: string }>
  onRunUpdate?: (task: AutomationTaskType, run: AutomationRunType) => void | Promise<void>
  now?: () => number
  intervalMs?: number
  concurrency?: number | (() => number)
  leaseMs?: number
  owner?: string
}

export class ScheduledTaskScheduler {
  #timer: ReturnType<typeof setInterval> | undefined
  #tick: Promise<AutomationRunType[]> | undefined
  #active = new Set<Promise<void>>()
  #owner: string

  constructor(private options: SchedulerOptions) {
    this.#owner = options.owner ?? `scheduled-task-${ulid()}`
  }

  async start() {
    if (this.#timer) return
    await this.recover()
    this.#timer = setInterval(() => this.scheduleTick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS)
  }

  stop() {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  async recover() {
    try {
      const now = this.now()
      Persistence.recover({ now })
      return await this.tick()
    } catch (error) {
      // Recovery runs during server startup. A transient database error must
      // not prevent the periodic scheduler from being started by its caller.
      safeLog("error", "scheduled task recovery failed", { error })
      return []
    }
  }

  async tick() {
    if (this.#tick) return this.#tick
    this.#tick = this.dispatch()
      .catch((error) => {
        // Keep the timer alive when a single database read/claim fails. The
        // next interval will retry the work instead of leaving a rejected
        // promise behind.
        safeLog("error", "scheduled task tick failed", { error })
        return []
      })
      .finally(() => {
        this.#tick = undefined
      })
    return this.#tick
  }

  active() {
    return this.#active.size
  }

  private async dispatch() {
    const now = this.now()
    const due = Persistence.claimDue({ now })
    due.forEach((run) => {
      const task = Persistence.get(run.taskID, { includeDeleted: true })
      if (task) this.notifyRunUpdate(task, run)
    })
    const claimed: AutomationRunType[] = []
    while (this.#active.size < this.concurrency()) {
      const next = Persistence.claimNextRun({ owner: this.#owner, now, leaseMs: this.leaseMs() })
      if (!next) return claimed
      claimed.push(next.run)
      this.notifyRunUpdate(next.task, next.run)
      this.launch(next)
    }
    return claimed
  }

  private launch(claim: ClaimedRun) {
    const execution = this.execute(claim)
    this.#active.add(execution)
    const settled = execution
      .catch((error) => {
        safeLog("error", "scheduled task execution escaped its error boundary", {
          taskID: claim.task.id,
          runID: claim.run.id,
          error,
        })
      })
      .finally(() => {
        this.#active.delete(execution)
        if (this.#timer) this.scheduleTick()
      })
    // Keep a final boundary around lifecycle callbacks as well. This is
    // defensive for custom Promise/thenable implementations supplied by a
    // host integration.
    void settled.catch((error) => {
      safeLog("error", "scheduled task completion callback failed", {
        taskID: claim.task.id,
        runID: claim.run.id,
        error,
      })
    })
  }

  private async execute(claim: ClaimedRun) {
    const timer = setInterval(() => {
      // Persistence is synchronous today, but keeping the callback in a
      // promise boundary also contains a future async implementation or a
      // rejected thenable returned by an adapter.
      void Promise.resolve()
        .then(() =>
          Persistence.renewLease({
            id: claim.run.id,
            owner: this.#owner,
            attempt: claim.run.attempt,
            now: this.now(),
            leaseMs: this.leaseMs(),
          }),
        )
        .catch((error) => {
          safeLog("warn", "scheduled task lease renewal failed", {
            taskID: claim.task.id,
            runID: claim.run.id,
            error,
          })
        })
    }, Math.max(1_000, Math.floor(this.leaseMs() / 3)))
    try {
      const result = AutomationRunExecution.parse((await this.options.execute(claim.task, claim.run)) ?? {})
      if (result.status === "waiting_for_session") {
        const sessionID = result.sessionID ?? claim.run.sessionID
        if (!sessionID) throw new Error("A waiting automation run requires a session ID")
        const updated = Persistence.markWaitingForSession({
          id: claim.run.id,
          owner: this.#owner,
          attempt: claim.run.attempt,
          sessionID,
          now: this.now(),
        })
        if (updated) this.notifyRunUpdate(claim.task, updated)
        return
      }
      if (result.status === "awaiting_user") {
        const updated = Persistence.markAwaitingUser({
          id: claim.run.id,
          owner: this.#owner,
          attempt: claim.run.attempt,
          sessionID: result.sessionID,
          now: this.now(),
        })
        if (updated) this.notifyRunUpdate(claim.task, updated)
        return
      }
      const updated = Persistence.completeRun({
        id: claim.run.id,
        owner: this.#owner,
        attempt: claim.run.attempt,
        status: "completed",
        sessionID: result.sessionID,
        result: result.result,
        now: this.now(),
      })
      if (updated) this.notifyRunUpdate(claim.task, updated)
    } catch (error) {
      try {
        const updated = Persistence.completeRun({
          id: claim.run.id,
          owner: this.#owner,
          attempt: claim.run.attempt,
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
          now: this.now(),
        })
        if (updated) this.notifyRunUpdate(claim.task, updated)
      } catch (completionError) {
        safeLog("error", "failed to persist scheduled task failure", {
          taskID: claim.task.id,
          runID: claim.run.id,
          error: completionError,
        })
      }
    } finally {
      clearInterval(timer)
    }
  }

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private concurrency() {
    const configured = typeof this.options.concurrency === "function" ? this.options.concurrency() : this.options.concurrency
    if (!Number.isFinite(configured)) return DEFAULT_CONCURRENCY
    return Math.min(Math.max(1, Math.trunc(configured ?? DEFAULT_CONCURRENCY)), 8)
  }

  private leaseMs() {
    return Math.max(10_000, this.options.leaseMs ?? DEFAULT_LEASE_MS)
  }

  private notifyRunUpdate(task: AutomationTaskType, run: AutomationRunType) {
    if (!this.options.onRunUpdate) return
    try {
      const result = this.options.onRunUpdate(task, run)
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch((error) => {
          safeLog("warn", "scheduled task update observer failed", { taskID: task.id, runID: run.id, error })
        })
      }
    } catch (error) {
      safeLog("warn", "scheduled task update observer failed", { taskID: task.id, runID: run.id, error })
    }
  }

  private scheduleTick() {
    // `tick` already has an error boundary; retain a second one around the
    // fire-and-forget call for callers running against an older subclass or
    // an injected scheduler implementation.
    void this.tick().catch((error) => {
      safeLog("error", "scheduled task tick failed", { error })
    })
  }
}

function safeLog(level: "warn" | "error", message: string, extra?: Record<string, unknown>) {
  try {
    const result = log[level](message, extra)
    // Log.init may install an async file writer even though Logger's public
    // type is void. Consume a rejected write so scheduler work cannot create
    // an unhandled rejection.
    void Promise.resolve(result).catch(() => {})
  } catch {
    // Logging must never take down scheduling.
  }
}

export function create(options: SchedulerOptions) {
  return new ScheduledTaskScheduler(options)
}

export const Scheduler = { create }
