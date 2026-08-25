import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect, Exit } from "effect"
import { ActorRegistry } from "../../src/actor/registry"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import { SessionRunState } from "../../src/session/run-state"
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

  test("archiving cancels an active session runner", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            const state = yield* SessionRunState.Service
            const session = yield* sessions.create({})
            yield* state
              .startShell(
                session.id,
                Effect.succeed({ info: {}, parts: [] } as never),
                Effect.never as never,
              )
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const response = yield* Effect.promise(async () =>
              Server.Default().app.request(`/session/${session.id}?directory=${encodeURIComponent(tmp.path)}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ time: { archived: Date.now() } }),
              }),
            )
            let idle = false
            for (let attempt = 0; attempt < 20; attempt++) {
              idle = Exit.isSuccess(yield* state.assertNotBusy(session.id).pipe(Effect.exit))
              if (idle) break
              yield* Effect.sleep("25 millis")
            }
            return {
              status: response.status,
              idle,
              archived: (yield* sessions.get(session.id)).time.archived,
            }
          }),
        ),
    })

    expect(result.status).toBe(200)
    expect(result.idle).toBe(true)
    expect(result.archived).toBeDefined()
  })

  test("Tavern continuation rejects non-Tavern sessions before prompting", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const res = await Server.Default().app.request(`/session/${session.id}/tavern-continuation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "alibaba", modelID: "qwen-plus" },
            system: "Tavern system prompt",
            nudge: "continue",
          }),
        })

        expect(res.status).toBe(403)
        expect(await res.text()).toContain("managed Tavern sessions")
        await svc.remove(session.id)
      },
    })
  })

  test("Tavern continuation constrains its internal nudge input", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const res = await Server.Default().app.request(`/session/${session.id}/tavern-continuation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "alibaba", modelID: "qwen-plus" },
            system: "Tavern system prompt",
            nudge: "x".repeat(1_001),
          }),
        })

        expect(res.status).toBe(400)
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
