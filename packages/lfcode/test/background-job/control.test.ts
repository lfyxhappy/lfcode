import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { cancelBackgroundJob, reconcileBackgroundJob, reconcileRunningBackgroundJobs } from "../../src/background-job/control"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("background job control", () => {
  test("cancelBackgroundJob kills a tracked live process and reconciles durable state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "cancel-live" })))
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", "setInterval(() => {}, 30000)"],
          cwd: tmp.path,
          stdout: "ignore",
          stderr: "ignore",
        })

        try {
          BackgroundJobPersistence.recordStart({
            id: "job-live-cancel",
            sessionID: session.id,
            kind: "shell",
            source: "tool",
            title: "Live cancel",
            cwd: tmp.path,
            payload: { command: "long-running" },
          })
          BackgroundJobPersistence.attachProcess({
            id: "job-live-cancel",
            pid: proc.pid,
          })

          const result = cancelBackgroundJob("job-live-cancel", "test")
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.code).toBe("cancelled")
          expect(result.job.status).toBe("cancelled")
          expect(result.job.pid).toBeUndefined()

          const exitCode = await proc.exited
          expect(exitCode).not.toBe(0)
          const logs = BackgroundJobPersistence.listLogs({ jobID: "job-live-cancel" })
          expect(logs.at(-1)?.stream).toBe("system")
          expect(logs.at(-1)?.text).toContain("Cancellation requested via test")
        } finally {
          proc.kill()
          await proc.exited.catch(() => undefined)
        }
      },
    })
  })

  test("reconcileBackgroundJob leaves live tracked processes running", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "reconcile-live" })))
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", "setInterval(() => {}, 30000)"],
          cwd: tmp.path,
          stdout: "ignore",
          stderr: "ignore",
        })

        try {
          BackgroundJobPersistence.recordStart({
            id: "job-live-reconcile",
            sessionID: session.id,
            kind: "shell",
            source: "tool",
            title: "Live reconcile",
            cwd: tmp.path,
            payload: { command: "long-running" },
          })
          BackgroundJobPersistence.attachProcess({
            id: "job-live-reconcile",
            pid: proc.pid,
          })

          const result = reconcileBackgroundJob("job-live-reconcile", "test")
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.code).toBe("still_running")
          expect(result.changed).toBe(false)
          expect(result.job.status).toBe("running")
          expect(result.job.pid).toBe(proc.pid)
        } finally {
          proc.kill()
          await proc.exited.catch(() => undefined)
        }
      },
    })
  })

  test("reconcileRunningBackgroundJobs marks missing tracked processes as failed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "reconcile-missing" })))
        BackgroundJobPersistence.recordStart({
          id: "job-missing-reconcile",
          sessionID: session.id,
          kind: "shell",
          source: "tool",
          title: "Missing reconcile",
          cwd: tmp.path,
          payload: { command: "long-running" },
        })
        BackgroundJobPersistence.attachProcess({
          id: "job-missing-reconcile",
          pid: 999999,
        })

        const results = reconcileRunningBackgroundJobs("test")
        const result = results.find((item) => item.ok && "job" in item && item.job.id === "job-missing-reconcile")
        expect(result?.ok).toBe(true)
        if (!result || !result.ok) return
        expect(result.code).toBe("reconciled_missing_process")
        expect(result.changed).toBe(true)
        expect(result.job.status).toBe("failed")
        expect(result.job.pid).toBeUndefined()
        expect(result.job.error).toContain("background-job reconcile")

        const logs = BackgroundJobPersistence.listLogs({ jobID: "job-missing-reconcile" })
        expect(logs.at(-1)?.stream).toBe("system")
        expect(logs.at(-1)?.text).toContain("Reconcile requested via test")
      },
    })
  })
})
