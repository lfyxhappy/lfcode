import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import { ActorRegistry } from "../../src/actor/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

function runActor<A, E>(fx: Effect.Effect<A, E, ActorRegistry.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(ActorRegistry.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  setArchived(input: { sessionID: SessionID; time?: number | null }) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((svc) => svc.remove(id)))
  },
}

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("session action routes", () => {
  test("abort route returns success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/abort`, { method: "POST" })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)

        await svc.remove(session.id)
      },
    })
  })

  test("update route clears archived time with null", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await svc.setArchived({ sessionID: session.id, time: Date.now() })

        const res = await Server.Default().app.request(`/session/${session.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ time: { archived: null } }),
        })

        expect(res.status).toBe(200)
        expect(((await res.json()) as SessionNs.Info).time.archived).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("delete actor route removes an idle subagent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await runActor(
          ActorRegistry.Service.use((svc) =>
            svc.register({
              sessionID: session.id,
              actorID: "explore-1",
              mode: "subagent",
              agent: "explore",
              description: "cleanup target",
              contextMode: "none",
              background: false,
              lifecycle: "ephemeral",
            }),
          ),
        )

        const res = await Server.Default().app.request(`/session/${session.id}/actors/explore-1`, {
          method: "DELETE",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        const actor = await runActor(ActorRegistry.Service.use((svc) => svc.get(session.id, "explore-1")))
        expect(actor).toBeUndefined()
      },
    })
  })

  test("delete actor route 404s for an unknown actor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const res = await Server.Default().app.request(`/session/${session.id}/actors/missing-actor`, {
          method: "DELETE",
        })

        expect(res.status).toBe(404)
      },
    })
  })
})
