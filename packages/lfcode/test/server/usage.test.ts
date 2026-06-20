import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionUsage } from "../../src/session/usage"
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
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function withoutWatcher<T>(fn: () => Promise<T>) {
  if (process.platform !== "win32") return fn()
  const prev = process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
    else process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = prev
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

async function fillStep(
  sessionID: SessionID,
  providerID: string,
  modelID: string,
  cost: number,
  input: number,
  output: number,
  overheadCost = 0,
) {
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  await svc.updateMessage({
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() + 1 },
    parentID: MessageID.ascending(),
    providerID,
    modelID,
    mode: "",
    agent: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Info)
  await svc.updatePart({
    id: partID,
    messageID,
    sessionID,
    type: "step-finish",
    reason: "stop",
    snapshot: undefined,
    cost,
    tokens: {
      total: input + output,
      input,
      output,
      reasoning: 0,
      cache: { read: 1, write: 2 },
    },
    ...(overheadCost
      ? {
          overhead: {
            cost: overheadCost,
            tokens: {
              total: 1,
              input: 1,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        }
      : {}),
  } as MessageV2.Part)
}

describe("usage route", () => {
  test("aggregates step-finish usage and filters by provider/model", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await svc.create({ title: "usage-session" })
          await fillStep(session.id, "anthropic", "claude-3", 1.25, 10, 20)
          await fillStep(session.id, "openai", "gpt-5", 2.5, 4, 6, 0.5)
          const body = SessionUsage.get({ range: "all", source: "lfcode", search: "usage-session" })
          expect(body.summary.requestCount).toBe(2)
          expect(body.summary.totalCost).toBe(4.25)
          expect(body.summary.overheadCost).toBe(0.5)
          expect(body.summary.totalTokens).toBe(46 + 1)
          expect(body.summary.overheadTokens).toBe(1)
          expect(body.providerStats.map((item) => item.provider)).toEqual(["anthropic", "openai"])
          expect(body.modelStats.map((item) => item.model)).toEqual(["claude-3", "gpt-5"])
          expect(body.logs[0]?.provider).toBe("openai")
          expect(body.logs[0]?.overheadCost).toBe(0.5)

          const filteredBody = SessionUsage.get({ range: "all", provider: "anthropic", source: "lfcode", search: "usage-session" })
          expect(filteredBody.summary.requestCount).toBe(1)
        },
      }),
    )
  }, 20000)

  test("keeps summary aggregates across all matches while paginating logs", async () => {
      await using tmp = await tmpdir({ git: true })
      await withoutWatcher(() =>
        Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await svc.create({ title: "paged-usage-session" })
            await fillStep(session.id, "anthropic", "claude-3", 1, 10, 20)
            await new Promise((resolve) => setTimeout(resolve, 2))
            await fillStep(session.id, "openai", "gpt-5", 2, 30, 40)
            await new Promise((resolve) => setTimeout(resolve, 2))
            await fillStep(session.id, "openai", "gpt-5-mini", 3, 50, 60)
            const body = SessionUsage.get({ range: "all", source: "lfcode", search: "paged-usage-session", limit: 1 })
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
  }, 20000)
})
