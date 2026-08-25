import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ActorDispatch } from "@/actor/dispatch"
import { AppRuntime } from "@/effect/app-runtime"
import { InboxTable } from "@/inbox/inbox.sql"
import { Instance } from "@/project/instance"
import { Server } from "@/server/server"
import { Session } from "@/session"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Database, eq } from "@/storage"
import { tmpdir } from "../fixture/fixture"

const app = Server.Default().app

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("actor dispatch routes", () => {
  test("lists safe dispatch state, updates concurrency, cancels, and receives results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((service) => service.create({ title: "dispatch route" })))
        const dispatch = await AppRuntime.runPromise(ActorDispatch.Service.use((service) => Effect.succeed(service)))
        const queued = await AppRuntime.runPromise(
          dispatch.enqueue({
            sessionID: session.id,
            actorID: "general-1",
            agent: "general",
            description: "queued task",
            context: "state",
            writeAccess: true,
            payload: {
              agent: "general",
              task: "private dispatch task",
              description: "queued task",
              context: "state",
              tools: "INHERIT",
            },
          }),
        )

        const list = await request(tmp.path, `/actor-dispatch?sessionID=${session.id}`)
        expect(list.status).toBe(200)
        const listBody = (await list.json()) as { items: Array<{ id: string; status: string; payload?: unknown }> }
        expect(listBody.items).toContainEqual(expect.objectContaining({ id: queued.id, status: "queued" }))
        expect(listBody.items.find((item) => item.id === queued.id)?.payload).toBeUndefined()

        const resumeFresh = await request(tmp.path, `/actor-dispatch/${queued.id}/resume?sessionID=${session.id}`, {
          method: "POST",
        })
        expect(resumeFresh.status).toBe(409)

        const config = await request(tmp.path, "/actor-dispatch/config")
        expect(config.status).toBe(200)
        expect(await config.json()).toEqual({ backgroundConcurrency: 4 })

        const updated = await request(tmp.path, "/actor-dispatch/config", {
          method: "PUT",
          body: { backgroundConcurrency: 2 },
        })
        expect(updated.status).toBe(200)
        expect(await updated.json()).toEqual({ backgroundConcurrency: 2 })

        const cancelled = await request(tmp.path, `/actor-dispatch/${queued.id}/cancel?sessionID=${session.id}`, {
          method: "POST",
        })
        expect(cancelled.status).toBe(200)
        expect((await cancelled.json() as { status: string }).status).toBe("cancelled")

        const completed = await AppRuntime.runPromise(
          dispatch.enqueue({
            sessionID: session.id,
            actorID: "general-2",
            agent: "general",
            description: "completed task",
            context: "state",
            writeAccess: true,
            payload: {
              agent: "general",
              task: "private completed task",
              description: "completed task",
              context: "state",
              tools: "INHERIT",
            },
          }),
        )
        await AppRuntime.runPromise(dispatch.claimNext(session.id))
        await AppRuntime.runPromise(dispatch.complete({ id: completed.id, status: "completed", result: "ready" }))

        await AppRuntime.runPromise(
          Session.Service.use((service) =>
            service.updateMessage({
              id: MessageID.ascending(),
              role: "user" as const,
              sessionID: session.id,
              agentID: "main",
              time: { created: Date.now() },
              agent: "general",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
            }),
          ),
        )

        const received = await request(tmp.path, `/actor-dispatch/${completed.id}/receive?sessionID=${session.id}`, {
          method: "POST",
        })
        expect(received.status).toBe(200)
        expect((await received.json() as { unread: boolean; status: string })).toEqual(
          expect.objectContaining({ status: "completed", unread: false }),
        )
        const parentMessages = await AppRuntime.runPromise(
          Session.Service.use((service) => service.messages({ sessionID: session.id, agentID: "main" })),
        )
        expect(
          parentMessages.some((message) =>
            message.parts.some((part) => part.type === "text" && part.synthetic && part.text.includes("ready")),
          ),
        ).toBe(true)
        const inbox = await AppRuntime.runPromise(
          Effect.sync(() =>
            Database.use((db) =>
              db.select().from(InboxTable).where(eq(InboxTable.receiver_session_id, session.id)).all(),
            ),
          ),
        )
        expect(
          inbox.some((row) => row.receiver_actor_id === "main" && row.sender_actor_id === "general-2"),
        ).toBe(false)
      },
    })
  })
})

function request(directory: string, path: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method,
    headers: {
      "content-type": "application/json",
      "x-lfcode-directory": directory,
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}
