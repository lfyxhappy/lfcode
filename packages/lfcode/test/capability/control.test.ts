import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { cancelBackgroundJob } from "../../src/background-job/control"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { disableCapability, stopCapabilityWork } from "../../src/capability/control"
import { decideCapabilityOperation } from "../../src/capability/gate"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("Agent OS capability control", () => {
  test("project stop cancels durable running jobs without booting other projects", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((service) => service.create({ title: "capability-stop" })))
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", "setInterval(() => {}, 30000)"],
          cwd: tmp.path,
          stdout: "ignore",
          stderr: "ignore",
        })
        try {
          BackgroundJobPersistence.recordStart({
            id: "capability-stop-job",
            sessionID: session.id,
            kind: "shell",
            source: "test",
            title: "Capability stop fixture",
            cwd: tmp.path,
            payload: { command: "long-running" },
          })
          BackgroundJobPersistence.attachProcess({ id: "capability-stop-job", pid: proc.pid })

          const result = await stopCapabilityWork({
            scope: "project",
            projectID: session.projectID,
            caller: "test",
            reason: "verify project stop",
          })

          expect(result.sessions).toContainEqual(expect.objectContaining({ id: session.id, status: "requested" }))
          expect(result.jobs).toContainEqual(expect.objectContaining({ id: "capability-stop-job", status: "cancelled" }))
          expect(BackgroundJobPersistence.load("capability-stop-job")?.status).toBe("cancelled")
          expect(await proc.exited).not.toBe(0)
        } finally {
          cancelBackgroundJob("capability-stop-job", "test-cleanup")
          proc.kill()
          await proc.exited.catch(() => undefined)
        }
      },
    })
  })

  test("disabling a capability writes a revoke sentinel used by later decisions", () => {
    const capability = `background_job_disable_${Date.now()}`
    const grant = disableCapability({ capability, caller: "test", reason: "verify disable" })

    expect(grant.revoked).toBe(true)
    expect(
      decideCapabilityOperation({
        caller: "test",
        capability,
        risk: "install",
        source: "official",
        operation: "install",
        previewed: true,
        reversible: true,
      }).decision,
    ).toBe("deny")
  })
})
