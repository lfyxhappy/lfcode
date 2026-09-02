import { describe, expect, test } from "bun:test"
import { Persistence, Scheduler, type AutomationTaskCreate } from "../../src/scheduled-task"

function input(name: string, patch?: Partial<AutomationTaskCreate>): AutomationTaskCreate {
  return {
    name,
    schedule: { kind: "interval", everyMs: 60_000 },
    target: { kind: "global" },
    message: "Run the automated check",
    agent: "main",
    permissionMode: "full",
    timezone: "UTC",
    enabled: true,
    notifications: "all",
    ...patch,
  }
}

describe("scheduled task persistence", () => {
  test("persists global concurrency settings and applies dynamic scheduler limits", async () => {
    const now = Date.UTC(2026, 0, 2, 9, 0)
    expect(Persistence.getSettings()).toEqual({ concurrency: 4 })
    expect(Persistence.updateSettings({ concurrency: 1 }, now)).toEqual({ concurrency: 1 })
    expect(Persistence.getSettings()).toEqual({ concurrency: 1 })
    expect(() => Persistence.updateSettings({ concurrency: 9 }, now)).toThrow()

    const first = Persistence.create(input("dynamic first"), now)
    const second = Persistence.create(input("dynamic second"), now)
    Persistence.runNow(first.id, now)
    Persistence.runNow(second.id, now + 1)
    const releases: (() => void)[] = []
    const scheduler = Scheduler.create({
      concurrency: () => Persistence.getSettings().concurrency,
      execute: () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        }),
    })

    await scheduler.tick()
    expect(scheduler.active()).toBe(1)
    Persistence.updateSettings({ concurrency: 2 }, now + 2)
    await scheduler.tick()
    expect(scheduler.active()).toBe(2)
    releases.forEach((release) => release())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scheduler.active()).toBe(0)
    Persistence.remove(first.id, now + 3)
    Persistence.remove(second.id, now + 3)
    Persistence.updateSettings({ concurrency: 4 }, now + 4)
  })

  test("coalesces overdue recurring work into one late run", () => {
    const now = Date.UTC(2026, 0, 2, 10, 0)
    const task = Persistence.create(
      input("late recurring", {
        schedule: { kind: "interval", everyMs: 60_000, anchorAt: now - 10 * 60_000 },
      }),
      now - 10 * 60_000,
    )

    const due = Persistence.claimDue({ now })
    expect(due.filter((run) => run.taskID === task.id)).toHaveLength(1)
    expect(due.find((run) => run.taskID === task.id)?.late).toBe(true)
    expect(Persistence.claimDue({ now }).filter((run) => run.taskID === task.id)).toHaveLength(0)
    expect(Persistence.get(task.id)?.nextRunAt).toBe(now + 60_000)
    Persistence.remove(task.id, now)
  })

  test("does not claim later automation for the same busy session", () => {
    const now = Date.UTC(2026, 0, 2, 11, 0)
    const sessionID = "scheduled-task-session-fifo"
    const first = Persistence.create(input("first session task", { target: { kind: "session", sessionID } }), now)
    const second = Persistence.create(input("second session task", { target: { kind: "session", sessionID } }), now)
    const firstRun = Persistence.runNow(first.id, now)!
    const secondRun = Persistence.runNow(second.id, now + 1)!
    const firstClaim = Persistence.claimNextRun({ owner: "scheduled-task-test", now, leaseMs: 10_000 })!

    expect(firstClaim.run.id).toBe(firstRun.id)
    Persistence.markWaitingForSession({
      id: firstRun.id,
      owner: "scheduled-task-test",
      attempt: firstClaim.run.attempt,
      sessionID,
      now,
    })
    expect(Persistence.claimNextRun({ owner: "scheduled-task-test", now: now + 1, leaseMs: 10_000 })).toBeUndefined()

    Persistence.requeueRun(firstRun.id, now + 2)
    const resumed = Persistence.claimNextRun({ owner: "scheduled-task-test", now: now + 2, leaseMs: 10_000 })!
    expect(resumed.run.id).toBe(firstRun.id)
    Persistence.completeRun({
      id: firstRun.id,
      owner: "scheduled-task-test",
      attempt: resumed.run.attempt,
      status: "completed",
      now: now + 3,
    })
    const next = Persistence.claimNextRun({ owner: "scheduled-task-test", now: now + 4, leaseMs: 10_000 })!
    expect(next.run.id).toBe(secondRun.id)
    Persistence.completeRun({
      id: secondRun.id,
      owner: "scheduled-task-test",
      attempt: next.run.attempt,
      status: "completed",
      now: now + 5,
    })
    Persistence.remove(first.id, now + 6)
    Persistence.remove(second.id, now + 6)
  })

  test("requeues expired leases but preserves active leases during scheduler recovery", async () => {
    const now = Date.UTC(2026, 0, 2, 12, 0)
    const task = Persistence.create(input("lease recovery"), now)
    const run = Persistence.runNow(task.id, now)!
    Persistence.claimNextRun({ owner: "expired-owner", now, leaseMs: 100 })
    expect(Persistence.recover({ now: now + 101 })).toEqual({ requeued: 1, purged: 0 })
    const recovered = Persistence.claimNextRun({ owner: "live-owner", now: now + 102, leaseMs: 60_000 })!
    expect(recovered.run.id).toBe(run.id)

    let calls = 0
    const scheduler = Scheduler.create({
      now: () => now + 103,
      execute: async () => {
        calls++
      },
    })
    await scheduler.recover()

    expect(calls).toBe(0)
    expect(Persistence.listRuns(task.id)[0]?.status).toBe("running")
    Persistence.completeRun({
      id: run.id,
      owner: "live-owner",
      attempt: recovered.run.attempt,
      status: "completed",
      now: now + 104,
    })
    Persistence.remove(task.id, now + 105)
  })

  test("requeues an unanswered permission request after restart recovery", () => {
    const now = Date.UTC(2026, 0, 2, 13, 0)
    const task = Persistence.create(input("approval recovery"), now)
    const run = Persistence.runNow(task.id, now)!
    const approvalClaim = Persistence.claimNextRun({ owner: "approval-owner", now, leaseMs: 60_000 })!
    Persistence.markAwaitingUser({ id: run.id, owner: "approval-owner", attempt: approvalClaim.run.attempt, now })

    expect(Persistence.recover({ now: now + 1 })).toEqual({ requeued: 1, purged: 0 })
    const recovered = Persistence.claimNextRun({ owner: "recovery-owner", now: now + 2, leaseMs: 60_000 })!
    expect(recovered.run.id).toBe(run.id)
    expect(recovered.run.trigger).toBe("recovery")
    Persistence.completeRun({
      id: run.id,
      owner: "recovery-owner",
      attempt: recovered.run.attempt,
      status: "completed",
      now: now + 3,
    })
    Persistence.remove(task.id, now + 4)
  })

  test("allows an explicit run while its task is paused", () => {
    const now = Date.UTC(2026, 0, 2, 13, 30)
    const task = Persistence.create(input("manual paused run"), now)
    Persistence.pause(task.id, now + 1)
    const run = Persistence.runNow(task.id, now + 2)!

    const claimed = Persistence.claimNextRun({ owner: "manual-owner", now: now + 3, leaseMs: 10_000 })
    expect(claimed?.run.id).toBe(run.id)
    expect(claimed?.run.status).toBe("running")
    Persistence.completeRun({ id: run.id, owner: "manual-owner", attempt: run.attempt, status: "completed", now: now + 4 })
    Persistence.remove(task.id, now + 5)
  })

  test("applies run limits in the query and returns latest runs in one batch", () => {
    const now = Date.UTC(2026, 0, 2, 13, 45)
    const firstTask = Persistence.create(input("limited history"), now)
    const secondTask = Persistence.create(input("latest history"), now)
    Persistence.runNow(firstTask.id, now + 1)
    const second = Persistence.runNow(firstTask.id, now + 2)!
    const third = Persistence.runNow(firstTask.id, now + 3)!
    const other = Persistence.runNow(secondTask.id, now + 4)!

    expect(Persistence.listRuns(firstTask.id, { limit: 1 }).map((run) => run.id)).toEqual([third.id])
    expect(Persistence.listRuns(firstTask.id, { limit: 2 }).map((run) => run.id)).toEqual([third.id, second.id])
    expect(new Map(Persistence.listLatestRuns([firstTask.id, secondTask.id]).map((run) => [run.taskID, run.id]))).toEqual(
      new Map([
        [firstTask.id, third.id],
        [secondTask.id, other.id],
      ]),
    )

    Persistence.remove(firstTask.id, now + 5)
    Persistence.remove(secondTask.id, now + 5)
  })

  test("fences stale workers after a lease recovery", () => {
    const now = Date.UTC(2026, 0, 2, 13, 45)
    const task = Persistence.create(input("stale worker"), now)
    const run = Persistence.runNow(task.id, now)!
    Persistence.claimNextRun({ owner: "reused-owner", now, leaseMs: 100 })

    expect(Persistence.recover({ now: now + 101 })).toEqual({ requeued: 1, purged: 0 })
    const recovered = Persistence.claimNextRun({ owner: "reused-owner", now: now + 102, leaseMs: 10_000 })!
    expect(recovered.run.attempt).toBe(run.attempt + 1)
    expect(Persistence.markWaitingForSession({
      id: run.id,
      owner: "reused-owner",
      attempt: run.attempt,
      sessionID: "busy-session",
      now: now + 103,
    })).toBeUndefined()
    expect(Persistence.completeRun({
      id: run.id,
      owner: "reused-owner",
      attempt: run.attempt,
      status: "failed",
      error: "stale",
      now: now + 104,
    })).toBeUndefined()
    expect(Persistence.renewLease({
      id: run.id,
      owner: "reused-owner",
      attempt: run.attempt,
      now: now + 104,
    })).toBeUndefined()
    expect(Persistence.renewLease({ id: run.id, owner: "reused-owner", now: now + 104 })).toBeUndefined()
    expect(Persistence.completeRun({ id: run.id, owner: "reused-owner", status: "failed", now: now + 104 })).toBeUndefined()
    expect(Persistence.listRuns(task.id)[0]?.status).toBe("running")
    Persistence.completeRun({ id: run.id, owner: "reused-owner", attempt: recovered.run.attempt, status: "completed", now: now + 105 })
    Persistence.remove(task.id, now + 106)
  })

  test("keeps a completed run terminal when a status observer fails", async () => {
    const now = Date.UTC(2026, 0, 2, 14, 0)
    const task = Persistence.create(input("observer isolation"), now)
    const run = Persistence.runNow(task.id, now)!
    const scheduler = Scheduler.create({
      now: () => now,
      execute: async () => ({ result: "done" }),
      onRunUpdate: () => {
        throw new Error("notification listener failed")
      },
    })

    await scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const finished = Persistence.listRuns(task.id).find((item) => item.id === run.id)
    expect(finished?.status).toBe("completed")
    expect(finished?.result).toBe("done")
    Persistence.remove(task.id, now + 1)
  })

  test("contains asynchronous observer rejections", async () => {
    const now = Date.UTC(2026, 0, 2, 14, 15)
    const task = Persistence.create(input("async observer isolation"), now)
    const run = Persistence.runNow(task.id, now)!
    const scheduler = Scheduler.create({
      now: () => now,
      execute: async () => ({ result: "done" }),
      onRunUpdate: async () => {
        throw new Error("async notification listener failed")
      },
    })

    await scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const finished = Persistence.listRuns(task.id).find((item) => item.id === run.id)
    expect(finished?.status).toBe("completed")
    expect(finished?.result).toBe("done")
    Persistence.remove(task.id, now + 1)
  })

  test("contains tick and startup recovery failures", async () => {
    const scheduler = Scheduler.create({
      now: () => {
        throw new Error("database clock unavailable")
      },
      execute: async () => undefined,
    })

    await expect(scheduler.tick()).resolves.toEqual([])
    await scheduler.start()
    scheduler.stop()
  })
})
