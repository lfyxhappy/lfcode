import { afterEach, describe, expect, test } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { Activity } from "../../src/activity"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

function seedSession(tag: string) {
  const projectID = ProjectID.make(`proj_activity_${tag}`)
  const sessionID = SessionID.make(`ses_activity_${tag}`)
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: `C:/tmp/${tag}`,
      name: tag,
      sandboxes: [],
    }).run()
    db.insert(SessionTable).values({
      id: sessionID,
      project_id: projectID,
      slug: tag,
      directory: `C:/tmp/${tag}`,
      title: tag,
      version: "v1",
    }).run()
  })
  return sessionID
}

async function withActivity(fn: (runtime: ManagedRuntime.ManagedRuntime<Activity.Service, never>) => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const runtime = ManagedRuntime.make(Activity.defaultLayer)
      try {
        await fn(runtime)
      } finally {
        await runtime.dispose()
      }
    },
  })
}

describe("Activity", () => {
  test("deduplicates sources and permits resumable main-session transitions", async () => {
    await withActivity(async (runtime) => {
      const sessionID = seedSession("dedupe")
      const service = await runtime.runPromise(Activity.Service.use((service) => Effect.succeed(service)))
      const first = await runtime.runPromise(
        service.create({
          sessionID,
          kind: "main",
          sourceType: "session",
          sourceID: sessionID,
        }),
      )
      const duplicate = await runtime.runPromise(
        service.create({
          sessionID,
          kind: "main",
          sourceType: "session",
          sourceID: sessionID,
        }),
      )

      expect(duplicate.id).toBe(first.id)
      const running = await runtime.runPromise(service.transition({ id: first.id, status: "running" }))
      expect(running?.revision).toBe(first.revision + 1)
      const waiting = await runtime.runPromise(service.transition({ id: first.id, status: "waiting" }))
      expect(waiting?.status).toBe("waiting")
      const resumed = await runtime.runPromise(service.transition({ id: first.id, status: "running" }))
      expect(resumed?.status).toBe("running")
    })
  })

  test("rejects stale and reverse transitions while making terminal completion idempotent", async () => {
    await withActivity(async (runtime) => {
      const sessionID = seedSession("transitions")
      const service = await runtime.runPromise(Activity.Service.use((service) => Effect.succeed(service)))
      const created = await runtime.runPromise(
        service.create({
          sessionID,
          kind: "subagent",
          sourceType: "actor",
          sourceID: "actor_transitions",
        }),
      )
      const running = await runtime.runPromise(service.transition({ id: created.id, status: "running" }))

      await expect(
        runtime.runPromise(service.transition({ id: created.id, status: "waiting", expectedRevision: created.revision })),
      ).rejects.toThrow("revision mismatch")
      await expect(runtime.runPromise(service.transition({ id: created.id, status: "queued" }))).rejects.toThrow(
        "cannot transition",
      )

      const completed = await runtime.runPromise(service.complete({ id: created.id }))
      const repeated = await runtime.runPromise(service.complete({ id: created.id }))
      expect(completed?.status).toBe("completed")
      expect(repeated?.revision).toBe(completed?.revision)
      expect(running?.status).toBe("running")
    })
  })
})
