import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
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
  options?: {
    agentID?: string
    status?: "completed" | "error" | "aborted"
    start?: number
    end?: number
    ttft?: number | null
    submitToFirstDelta?: number | null
    preStream?: number | null
  },
) {
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  await svc.updateMessage({
    id: messageID,
    sessionID,
    agentID: options?.agentID,
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
    status: options?.status,
    time:
      options?.start != null && options?.end != null
        ? {
            start: options.start,
            end: options.end,
            ttft: options?.ttft ?? null,
            submit_to_first_delta: options?.submitToFirstDelta ?? null,
            pre_stream: options?.preStream ?? null,
          }
        : undefined,
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

  test("preserves step timing/status and counts terminal failures", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await svc.create({ title: "failed-usage-session" })
          await fillStep(session.id, "openai", "gpt-5", 1.5, 10, 20, 0, {
            start: 1_000,
            end: 4_500,
            ttft: 500,
          })
          await fillStep(session.id, "openai", "gpt-5", 0, 0, 0, 0, {
            status: "error",
            start: 5_000,
            end: 5_800,
            ttft: null,
          })

          const body = SessionUsage.get({ range: "all", source: "lfcode", search: "failed-usage-session" })

          expect(body.summary.requestCount).toBe(2)
          expect(body.logs).toHaveLength(2)
          expect(body.logs[0]?.status).toBe("error")
          expect(body.logs[0]?.duration).toBe(800)
          expect(body.logs[0]?.ttft).toBeNull()
          expect(body.logs[0]?.submitToFirstDelta).toBeNull()
          expect(body.logs[0]?.preStream).toBeNull()
          expect(body.logs[1]?.status).toBe("completed")
          expect(body.logs[1]?.duration).toBe(3500)
          expect(body.logs[1]?.ttft).toBe(500)
        },
      }),
    )
  }, 20000)

  test("reads submit to first delta and pre stream timing from step finish parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await svc.create({ title: "timing-usage-session" })
          await fillStep(session.id, "openai", "gpt-5", 1, 10, 20, 0, {
            start: 1_000,
            end: 2_000,
            ttft: 100,
            submitToFirstDelta: 450,
            preStream: 300,
          })

          const body = SessionUsage.get({ range: "all", source: "lfcode", search: "timing-usage-session" })

          expect(body.summary.requestCount).toBe(1)
          expect(body.logs[0]?.submitToFirstDelta).toBe(450)
          expect(body.logs[0]?.preStream).toBe(300)
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

  test("supports project/session/status/agent filters and exposes project and session stats", async () => {
    await using projectAlpha = await tmpdir({ git: true })
    await using projectBeta = await tmpdir({ git: true })
    let alphaProjectID = ""
    let betaProjectID = ""
    let rootSessionID: SessionID | undefined
    let childSessionID: SessionID | undefined
    let betaSessionID: SessionID | undefined

    await withoutWatcher(() =>
      Instance.provide({
        directory: projectAlpha.path,
        fn: async () => {
          alphaProjectID = Instance.project.id
          const root = await svc.create({ title: "usage-buckets-root" })
          const child = await svc.create({ title: "usage-buckets-child", parentID: root.id })
          rootSessionID = root.id
          childSessionID = child.id

          await fillStep(root.id, "openai", "gpt-5", 1, 10, 5, 0, {
            status: "completed",
            start: 1_000,
            end: 3_000,
            ttft: 100,
          })
          await fillStep(root.id, "openai", "gpt-5-mini", 2, 20, 10, 0, {
            status: "aborted",
            start: 4_000,
            end: 4_500,
            ttft: 200,
          })
          await fillStep(child.id, "anthropic", "claude-3-5-sonnet", 0.5, 30, 15, 0, {
            agentID: "explore-1",
            status: "error",
            start: 5_000,
            end: 6_000,
            ttft: null,
          })
        },
      }),
    )

    await withoutWatcher(() =>
      Instance.provide({
        directory: projectBeta.path,
        fn: async () => {
          betaProjectID = Instance.project.id
          const session = await svc.create({ title: "usage-buckets-beta" })
          betaSessionID = session.id
          await fillStep(session.id, "google", "gemini-2.5-pro", 3, 40, 20, 0, {
            status: "completed",
            start: 7_000,
            end: 10_000,
            ttft: 400,
          })
        },
      }),
    )

    const body = SessionUsage.get({ range: "all", source: "lfcode", search: "usage-buckets" })
    expect(body.summary.requestCount).toBe(4)
    expect(body.summary.successCount).toBe(2)
    expect(body.summary.errorCount).toBe(1)
    expect(body.summary.abortedCount).toBe(1)
    expect(body.summary.successRate).toBe(50)
    expect(body.summary.avgDuration).toBe(1625)
    expect(body.summary.avgTtft).toBeCloseTo(700 / 3, 5)
    expect(body.projectStats).toHaveLength(2)
    expect(body.sessionStats).toHaveLength(3)

    expect(body.projectStats[0]).toMatchObject({
      projectID: alphaProjectID,
      directory: projectAlpha.path,
      requestCount: 3,
      totalTokens: 99,
      totalCost: 3.5,
    })
    expect(body.projectStats[0]?.projectName).toBe(path.basename(projectAlpha.path))
    expect(body.projectStats[0]?.share).toBeCloseTo((99 / 162) * 100, 5)
    expect(body.projectStats[1]).toMatchObject({
      projectID: betaProjectID,
      directory: projectBeta.path,
      requestCount: 1,
      totalTokens: 63,
      totalCost: 3,
    })

    const rootStat = body.sessionStats.find((item) => item.sessionID === rootSessionID)
    expect(rootStat).toMatchObject({
      sessionID: rootSessionID,
      sessionTitle: "usage-buckets-root",
      totalTokens: 51,
      totalCost: 3,
      requestCount: 2,
    })
    const childStat = body.sessionStats.find((item) => item.sessionID === childSessionID)
    expect(childStat).toMatchObject({
      sessionID: childSessionID,
      sessionTitle: "usage-buckets-child",
      totalTokens: 48,
      totalCost: 0.5,
      requestCount: 1,
    })

    const projectFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      project: alphaProjectID,
    })
    expect(projectFiltered.summary.requestCount).toBe(3)
    expect(projectFiltered.logs.every((item) => item.projectID === alphaProjectID)).toBe(true)

    const sessionFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      session: rootSessionID,
    })
    expect(sessionFiltered.summary.requestCount).toBe(2)
    expect(sessionFiltered.logs.every((item) => item.sessionID === rootSessionID)).toBe(true)

    const statusFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      status: "error",
    })
    expect(statusFiltered.summary.requestCount).toBe(1)
    expect(statusFiltered.logs.map((item) => item.status)).toEqual(["error"])

    const mainFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      agent_kind: "main",
    })
    expect(mainFiltered.summary.requestCount).toBe(3)
    expect(mainFiltered.logs.every((item) => item.agentKind === "main")).toBe(true)

    const subagentFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      agent_kind: "subagent",
    })
    expect(subagentFiltered.summary.requestCount).toBe(1)
    expect(subagentFiltered.logs[0]).toMatchObject({
      sessionID: childSessionID,
      agentID: "explore-1",
      agentKind: "subagent",
      status: "error",
    })

    const betaSessionFiltered = SessionUsage.get({
      range: "all",
      source: "lfcode",
      search: "usage-buckets",
      session: betaSessionID,
    })
    expect(betaSessionFiltered.summary.totalTokens).toBe(63)
    expect(betaSessionFiltered.summary.totalCost).toBe(3)
  }, 20000)
})
