import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { CapabilityPersistence } from "../../src/capability/persistence"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("background job routes", () => {
  test("GET /background-job lists durable jobs and filters by session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "first" })))
        const second = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "second" })))

        BackgroundJobPersistence.recordStart({
          id: "job-first",
          sessionID: first.id,
          kind: "shell",
          source: "tool",
          title: "First job",
          cwd: tmp.path,
          payload: { command: "echo first" },
        })
        BackgroundJobPersistence.recordStart({
          id: "job-second",
          sessionID: second.id,
          kind: "python",
          source: "tool",
          title: "Second job",
          cwd: tmp.path,
          payload: { code: "print('second')" },
        })
        BackgroundJobPersistence.recordTerminal({
          id: "job-second",
          status: "completed",
          exitCode: 0,
        })

        const response = await Server.Default().app.request(`/background-job?sessionID=${first.id}`, {
          method: "GET",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Array<{ id: string; sessionID: string; status: string }>
        expect(body).toEqual([
          expect.objectContaining({
            id: "job-first",
            sessionID: first.id,
            status: "running",
          }),
        ])
        expect(CapabilityPersistence.listAudit({ capability: "context_read" })).toContainEqual(
          expect.objectContaining({
            caller: "route:background-job",
            rollback: expect.objectContaining({ sessions: [first.id], jobs: ["job-first"] }),
          }),
        )
      },
    })
  })

  test("GET /background-job/:jobID and /background-job/:jobID/log return persisted detail and logs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "detail" })))

        BackgroundJobPersistence.recordStart({
          id: "job-detail",
          sessionID: session.id,
          kind: "shell",
          source: "tool",
          title: "Detail job",
          cwd: tmp.path,
          payload: { command: "echo detail" },
        })
        BackgroundJobPersistence.appendLog({
          jobID: "job-detail",
          sessionID: session.id,
          seq: 1,
          stream: "stdout",
          text: "hello",
        })
        BackgroundJobPersistence.appendLog({
          jobID: "job-detail",
          sessionID: session.id,
          seq: 2,
          stream: "stderr",
          text: "warn",
        })

        const detail = await Server.Default().app.request("/background-job/job-detail", {
          method: "GET",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })
        expect(detail.status).toBe(200)
        const detailBody = (await detail.json()) as { id: string; payload: { command: string } }
        expect(detailBody.id).toBe("job-detail")
        expect(detailBody.payload.command).toBe("echo detail")

        const logs = await Server.Default().app.request("/background-job/job-detail/log?afterSeq=1", {
          method: "GET",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })
        expect(logs.status).toBe(200)
        const logsBody = (await logs.json()) as Array<{ seq: number; stream: string; text: string }>
        expect(logsBody).toHaveLength(1)
        expect(logsBody[0]?.seq).toBe(2)
        expect(logsBody[0]?.stream).toBe("stderr")
        expect(logsBody[0]?.text).toBe("warn")
        expect(CapabilityPersistence.listAudit({ capability: "context_read" })).toContainEqual(
          expect.objectContaining({
            caller: "route:background-job",
            rollback: expect.objectContaining({ jobs: ["job-detail"], logCount: 1 }),
          }),
        )
      },
    })
  })

  test("POST /background-job/:jobID/cancel reports unmanaged running jobs honestly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "cancel" })))

        BackgroundJobPersistence.recordStart({
          id: "job-unmanaged",
          sessionID: session.id,
          kind: "shell",
          source: "tool",
          title: "Unmanaged job",
          cwd: tmp.path,
          payload: { command: "sleep" },
        })

        const response = await Server.Default().app.request("/background-job/job-unmanaged/cancel", {
          method: "POST",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { code: string; changed: boolean; job: { status: string } }
        expect(body.code).toBe("unmanaged_running")
        expect(body.changed).toBe(false)
        expect(body.job.status).toBe("running")
      },
    })
  })

  test("POST /background-job/:jobID/reconcile marks missing tracked processes as failed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "reconcile" })))

        BackgroundJobPersistence.recordStart({
          id: "job-stale",
          sessionID: session.id,
          kind: "shell",
          source: "tool",
          title: "Stale job",
          cwd: tmp.path,
          payload: { command: "sleep" },
        })
        BackgroundJobPersistence.attachProcess({ id: "job-stale", pid: 999_999 })

        const response = await Server.Default().app.request("/background-job/job-stale/reconcile", {
          method: "POST",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { code: string; changed: boolean; job: { status: string; pid?: number } }
        expect(body.code).toBe("reconciled_missing_process")
        expect(body.changed).toBe(true)
        expect(body.job.status).toBe("failed")
        expect(body.job.pid).toBeUndefined()
      },
    })
  })
})
