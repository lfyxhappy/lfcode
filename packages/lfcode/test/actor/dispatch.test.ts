import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ActorDispatch } from "../../src/actor/dispatch"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const testLayer = Layer.mergeAll(Session.defaultLayer, ActorDispatch.defaultLayer)

afterEach(async () => {
  await Instance.disposeAll()
})

async function withDispatch(
  directory: string,
  fn: (runtime: ManagedRuntime.ManagedRuntime<Session.Service | ActorDispatch.Service, never>) => Promise<void>,
) {
  return Instance.provide({
    directory,
    fn: async () => {
      const runtime = ManagedRuntime.make(testLayer)
      try {
        await fn(runtime)
      } finally {
        await runtime.dispose()
      }
    },
  })
}

function queued(sessionID: SessionID, actorID: string, declaredFiles?: string[]) {
  return {
    sessionID,
    actorID,
    agent: "general",
    description: actorID,
    context: "state" as const,
    ...(declaredFiles ? { declaredFiles } : {}),
    writeAccess: true,
    payload: {
      agent: "general",
      task: `handle ${actorID}`,
      description: actorID,
      context: "state" as const,
      tools: "INHERIT" as const,
      ...(declaredFiles ? { declaredFiles } : {}),
    },
  }
}

function researchQueued(sessionID: SessionID) {
  return {
    ...queued(sessionID, "deep-research"),
    agent: "deep-research-coordinator",
    payload: {
      ...queued(sessionID, "deep-research").payload,
      agent: "deep-research-coordinator",
      research: {
        kind: "deep-research" as const,
        title: "Research the market",
        depth: "standard" as const,
        phase: "planning" as const,
        subtaskCount: 0,
        sourceCount: 0,
        citations: [],
      },
    },
  }
}

describe("ActorDispatch", () => {
  test("claims queued work in FIFO order within the configured session limit", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      await runtime.runPromise(dispatch.setConcurrency(1))

      const first = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1")))
      const second = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-2")))

      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.id).toBe(first.id)
      expect(await runtime.runPromise(dispatch.claimNext(session.id))).toBeUndefined()

      await runtime.runPromise(dispatch.complete({ id: first.id, status: "completed", result: "done" }))
      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.id).toBe(second.id)
    })
  })

  test("enforces the concurrency limit independently for each session", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const firstSession = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const secondSession = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      await runtime.runPromise(dispatch.setConcurrency(1))

      const first = await runtime.runPromise(dispatch.enqueue(queued(firstSession.id, "general-1")))
      const second = await runtime.runPromise(dispatch.enqueue(queued(secondSession.id, "general-2")))

      expect((await runtime.runPromise(dispatch.claimNext(firstSession.id)))?.id).toBe(first.id)
      expect((await runtime.runPromise(dispatch.claimNext(secondSession.id)))?.id).toBe(second.id)
    })
  })

  test("serializes conflicting writers without blocking independent work", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      await runtime.runPromise(dispatch.setConcurrency(2))

      const first = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1", ["src/shared.ts"])))
      const blocked = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-2", ["src/shared.ts"])))
      const independent = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-3", ["src/other.ts"])))

      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.id).toBe(first.id)
      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.id).toBe(independent.id)
      expect(await runtime.runPromise(dispatch.claimNext(session.id))).toBeUndefined()
      expect((await runtime.runPromise(dispatch.get(blocked.id)))?.status).toBe("queued")

      await runtime.runPromise(dispatch.complete({ id: first.id, status: "completed" }))
      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.id).toBe(blocked.id)
    })
  })

  test("persists conflict hints, cancellation, and unread completion results", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      await runtime.runPromise(dispatch.setConcurrency(8))

      const first = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1", ["src/shared.ts"])))
      const second = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-2", ["src/shared.ts"])))
      const listed = await runtime.runPromise(dispatch.list(session.id))

      expect(listed.find((entry) => entry.id === first.id)?.conflicts).toContain(second.id)
      expect(listed.find((entry) => entry.id === second.id)?.conflicts).toContain(first.id)

      await runtime.runPromise(dispatch.recordActualFiles(first.id, ["src/edited.ts"]))
      expect((await runtime.runPromise(dispatch.get(first.id)))?.actualFiles).toContain("src/edited.ts")

      await runtime.runPromise(dispatch.cancel({ sessionID: session.id, id: second.id }))
      expect((await runtime.runPromise(dispatch.get(second.id)))?.status).toBe("cancelled")

      await runtime.runPromise(dispatch.claimNext(session.id))
      const completed = await runtime.runPromise(dispatch.complete({ id: first.id, status: "completed", result: "ready" }))
      expect(completed?.unread).toBe(true)
      expect((await runtime.runPromise(dispatch.receive(session.id, first.id)))?.unread).toBe(false)
    })
  })

  test("marks persisted queued work for manual recovery after restart", async () => {
    await using tmp = await tmpdir({ git: true })
    let sessionID: SessionID | undefined
    let dispatchID: string | undefined

    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      sessionID = session.id
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      dispatchID = (await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1")))).id
    })

    await withDispatch(tmp.path, async (runtime) => {
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      const recovered = await runtime.runPromise(dispatch.getForSession(sessionID!, dispatchID!))
      expect(recovered?.status).toBe("queued")
      expect(recovered?.manualResume).toBe(true)
      expect(await runtime.runPromise(dispatch.claimNext(sessionID!))).toBeUndefined()
    })
  })

  test("marks running work interrupted after restart", async () => {
    await using tmp = await tmpdir({ git: true })
    let sessionID: SessionID | undefined
    let dispatchID: string | undefined

    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      sessionID = session.id
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      dispatchID = (await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1")))).id
      expect((await runtime.runPromise(dispatch.claimNext(session.id)))?.status).toBe("running")
    })

    await withDispatch(tmp.path, async (runtime) => {
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      const recovered = await runtime.runPromise(dispatch.getForSession(sessionID!, dispatchID!))
      expect(recovered?.status).toBe("interrupted")
      expect(recovered?.manualResume).toBe(true)
    })
  })

  test("only permits manual recovery after a restart", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      const record = await runtime.runPromise(dispatch.enqueue(queued(session.id, "general-1")))

      const attempted = await runtime.runPromise(dispatch.resume(session.id, record.id))
      expect(attempted?.status).toBe("queued")
      expect(attempted?.manualResume).toBe(false)
      expect((await runtime.runPromise(dispatch.get(record.id)))?.status).toBe("queued")
    })
  })

  test("persists research progress and promotes cited results on completion", async () => {
    await using tmp = await tmpdir({ git: true })
    await withDispatch(tmp.path, async (runtime) => {
      const session = await runtime.runPromise(Session.Service.use((svc) => svc.create()))
      const dispatch = await runtime.runPromise(ActorDispatch.Service.use((svc) => Effect.succeed(svc)))
      const queuedResearch = await runtime.runPromise(dispatch.enqueue(researchQueued(session.id)))
      const running = await runtime.runPromise(dispatch.claimNext(session.id))

      expect(running?.research?.phase).toBe("retrieving")
      expect(running?.research?.title).toBe("Research the market")
      const verifying = await runtime.runPromise(
        dispatch.updateResearch({ id: queuedResearch.id, phase: "verifying", subtaskCount: 2 }),
      )
      expect(verifying?.research?.phase).toBe("verifying")
      expect(verifying?.research?.subtaskCount).toBe(2)
      const completed = await runtime.runPromise(
        dispatch.complete({
          id: queuedResearch.id,
          status: "completed",
          subtaskCount: 3,
          result: "Evidence: https://example.com/report",
        }),
      )

      expect(completed?.research?.phase).toBe("completed")
      expect(completed?.research?.subtaskCount).toBe(3)
      expect(completed?.research?.sourceCount).toBe(1)
      expect(completed?.research?.citations).toContain("https://example.com/report")
    })
  })
})
