import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, type SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function withoutWatcher<T>(fn: () => Promise<T>) {
  if (process.platform !== "win32") return fn()
  const prev = process.env.MIMOCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  process.env.MIMOCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.MIMOCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
    else process.env.MIMOCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = prev
  }
}

async function fill(sessionID: SessionID, providerID: string, modelID: string, cost: number, input: number, output: number) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() + 1 },
    parentID: MessageID.ascending(),
    providerID,
    modelID,
    mode: "",
    agent: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost,
    tokens: {
      input,
      output,
      reasoning: 0,
      cache: { read: 1, write: 2 },
    },
  } as unknown as MessageV2.Info)
}

describe("usage route", () => {
  test(
    "aggregates assistant usage and filters by provider/model",
    async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await svc.create({ title: "usage-session" })
          await fill(session.id, "anthropic", "claude-3", 1.25, 10, 20)
          await fill(session.id, "openai", "gpt-5", 2.5, 4, 6)
          const app = Server.Default().app

          const res = await app.request(`/usage?range=all&source=opencode&search=usage-session`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            summary: { totalTokens: number; requestCount: number; totalCost: number }
            logs: Array<{ provider: string; model: string }>
            providerStats: Array<{ provider: string; requestCount: number }>
            modelStats: Array<{ provider: string; model: string }>
          }
          expect(body.summary.requestCount).toBe(2)
          expect(body.summary.totalCost).toBe(3.75)
          expect(body.summary.totalTokens).toBe(46)
          expect(body.providerStats.map((item) => item.provider)).toEqual(["anthropic", "openai"])
          expect(body.modelStats.map((item) => item.model)).toEqual(["claude-3", "gpt-5"])
          expect(body.logs[0]?.provider).toBe("openai")

          const filtered = await app.request(`/usage?range=all&provider=anthropic&source=opencode&search=usage-session`)
          expect(filtered.status).toBe(200)
          const filteredBody = (await filtered.json()) as { summary: { requestCount: number } }
          expect(filteredBody.summary.requestCount).toBe(1)
        },
      }),
    )
    },
    20000,
  )

  test(
    "keeps summary aggregates across all matches while paginating logs",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await withoutWatcher(() =>
        Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await svc.create({ title: "paged-usage-session" })
            await fill(session.id, "anthropic", "claude-3", 1, 10, 20)
            await new Promise((resolve) => setTimeout(resolve, 2))
            await fill(session.id, "openai", "gpt-5", 2, 30, 40)
            await new Promise((resolve) => setTimeout(resolve, 2))
            await fill(session.id, "openai", "gpt-5-mini", 3, 50, 60)
            const app = Server.Default().app

            const res = await app.request(`/usage?range=all&source=opencode&search=paged-usage-session&limit=1`)
            expect(res.status).toBe(200)
            const body = (await res.json()) as {
              summary: { requestCount: number; totalCost: number; totalTokens: number }
              trend: Array<{ input: number; output: number }>
              logs: Array<{ model: string; duration: number | null; ttft: number | null }>
              nextCursor: number | null
            }
            expect(body.summary.requestCount).toBe(3)
            expect(body.summary.totalCost).toBe(6)
            expect(body.summary.totalTokens).toBe(219)
            expect(body.trend.reduce((sum, item) => sum + item.input, 0)).toBe(90)
            expect(body.trend.reduce((sum, item) => sum + item.output, 0)).toBe(120)
            expect(body.logs).toHaveLength(1)
            expect(body.logs[0]?.model).toBe("gpt-5-mini")
            expect(body.logs[0]?.duration).toBeNull()
            expect(body.logs[0]?.ttft).toBeNull()
            expect(body.nextCursor).not.toBeNull()
          },
        }),
      )
    },
    20000,
  )
})
