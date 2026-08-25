import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Inbox } from "../../src/inbox"
import { MAX_CONSECUTIVE_COMPLETION_WAKES } from "../../src/inbox/inbox"
import { ActorRegistry } from "../../src/actor/registry"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { InboxTable } from "../../src/inbox/inbox.sql"
import { Database, and, eq } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

const base = Layer.mergeAll(Session.defaultLayer, ActorRegistry.defaultLayer, Bus.defaultLayer)
const testLayer = Inbox.layer.pipe(Layer.provide(base), Layer.provideMerge(base))

type Runtime = ManagedRuntime.ManagedRuntime<Inbox.Service | Session.Service | ActorRegistry.Service | Bus.Service, never>

afterEach(async () => {
  await Instance.disposeAll()
})

async function withInbox(directory: string, fn: (runtime: Runtime) => Promise<void>) {
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

async function registerIdleReceiver(runtime: Runtime) {
  const session = await runtime.runPromise(Session.Service.use((service) => service.create()))
  await runtime.runPromise(
    ActorRegistry.Service.use((registry) =>
      registry.register({
        sessionID: session.id,
        actorID: "owner",
        mode: "subagent",
        agent: "general",
        description: "main receiver",
        contextMode: "none",
        background: false,
        lifecycle: "persistent",
      }),
    ),
  )
  await runtime.runPromise(
    ActorRegistry.Service.use((registry) => registry.updateStatus(session.id, "owner", { status: "idle" })),
  )
  return session
}

function completion(id: string) {
  return {
    source: "shell-job" as const,
    id,
    status: "completed" as const,
    summary: `${id} completed`,
    finishedAt: 1,
    collectAction: `collect ${id}`,
    dedupeKey: `shell-job:${id}:completed`,
  }
}

describe("Inbox completion notifications", () => {
  test("dedupes pending envelopes and bounds consecutive idle wakes", async () => {
    await using tmp = await tmpdir({ git: true })
    await withInbox(tmp.path, async (runtime) => {
      const session = await registerIdleReceiver(runtime)
      const results = await runtime.runPromise(
        Inbox.Service.use((inbox) =>
          Effect.all(
            Array.from({ length: MAX_CONSECUTIVE_COMPLETION_WAKES + 1 }, (_, index) =>
              inbox.sendCompletion!({
                receiverSessionID: session.id,
                receiverActorID: "owner",
                notification: completion(`job-${index}`),
              }),
            ),
            { concurrency: 1 },
          ),
        ),
      )

      expect(results.map((result) => result.wakeScheduled)).toEqual([true, true, true, false])

      const duplicate = await runtime.runPromise(
        Inbox.Service.use((inbox) =>
          inbox.sendCompletion!({
            receiverSessionID: session.id,
            receiverActorID: "owner",
            notification: completion("job-0"),
          }),
        ),
      )
      expect(duplicate.inboxID).toBe(results[0].inboxID)
      expect(duplicate.wakeScheduled).toBe(false)

      const rows = Database.use((db) =>
        db
          .select()
          .from(InboxTable)
          .where(and(eq(InboxTable.receiver_session_id, session.id), eq(InboxTable.receiver_actor_id, "owner")))
          .all(),
      )
      expect(rows).toHaveLength(MAX_CONSECUTIVE_COMPLETION_WAKES + 1)

      await runtime.runPromise(
        Inbox.Service.use((inbox) => inbox.resetCompletionWakeBudget!({ sessionID: session.id, actorID: "owner" })),
      )
      const rearmed = await runtime.runPromise(
        Inbox.Service.use((inbox) =>
          inbox.sendCompletion!({
            receiverSessionID: session.id,
            receiverActorID: "owner",
            notification: completion("job-rearmed"),
          }),
        ),
      )
      expect(rearmed.wakeScheduled).toBe(true)
    })
  })

  test("busy receivers are not constrained by the idle wake budget", async () => {
    await using tmp = await tmpdir({ git: true })
    await withInbox(tmp.path, async (runtime) => {
      const session = await registerIdleReceiver(runtime)
      await runtime.runPromise(
        Inbox.Service.use((inbox) =>
          Effect.all(
            Array.from({ length: MAX_CONSECUTIVE_COMPLETION_WAKES }, (_, index) =>
              inbox.sendCompletion!({
                receiverSessionID: session.id,
                receiverActorID: "owner",
                notification: completion(`idle-${index}`),
              }),
            ),
            { concurrency: 1 },
          ),
        ),
      )
      await runtime.runPromise(
        ActorRegistry.Service.use((registry) => registry.updateStatus(session.id, "owner", { status: "running" })),
      )
      const result = await runtime.runPromise(
        Inbox.Service.use((inbox) =>
          inbox.sendCompletion!({
            receiverSessionID: session.id,
            receiverActorID: "owner",
            notification: completion("busy"),
          }),
        ),
      )
      expect(result.wakeScheduled).toBe(true)
    })
  })
})
