import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { EditHistoryTool } from "../../src/tool/edit_history"
import { Truncate } from "../../src/tool"
import { tmpdir } from "../fixture/fixture"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const env = Layer.mergeAll(SessionNs.defaultLayer, Agent.defaultLayer, Truncate.defaultLayer)

const ctx = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.make("msg_tool"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const seedEdit = Effect.fn("seedEdit")(function* (input: { sessionID: SessionID; label: string; at: number; agentID?: string }) {
  const ssn = yield* SessionNs.Service
  const userID = MessageID.ascending()
  yield* ssn.updateMessage({
    id: userID,
    role: "user" as const,
    sessionID: input.sessionID,
    agent: "build",
    model: ref,
    time: { created: input.at },
  })
  yield* ssn.updatePart({
    id: PartID.ascending(),
    messageID: userID,
    sessionID: input.sessionID,
    type: "text",
    text: input.label,
  })

  const assistantID = MessageID.ascending()
  yield* ssn.updateMessage({
    id: assistantID,
    role: "assistant" as const,
    sessionID: input.sessionID,
    agentID: input.agentID ?? "main",
    agent: "build",
    mode: "primary",
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID: userID,
    time: { created: input.at + 1, completed: input.at + 2 },
    finish: "end_turn",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    path: { cwd: "/", root: "/" },
    cost: 0,
  })
  yield* ssn.updatePart({
    id: PartID.ascending(),
    messageID: assistantID,
    sessionID: input.sessionID,
    type: "tool",
    tool: "edit",
    callID: `call-${input.label}`,
    state: {
      status: "completed",
      input: {},
      output: "done",
      title: "",
      metadata: {
        files: [
          {
            file: `/tmp/${input.label}.ts`,
            patch: `@@ -1 +1 @@\n-${input.label}-before\n+${input.label}-after\n`,
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
      },
      time: { start: input.at + 1, end: input.at + 2 },
    },
  } as never)

  return { userID, assistantID }
})

const execute = (params: { scope?: "tool" | "session"; limit?: number }, sessionID: SessionID) =>
  EditHistoryTool.pipe(
    Effect.flatMap((info) => info.init()),
    Effect.flatMap((tool) => tool.execute(params, ctx(sessionID))),
  )

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.edit_history", () => {
  test("scope=tool lists newest tool-level edits first", async () => {
    await using fixture = await tmpdir()
    const result = await Instance.provide({
      directory: fixture.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const ssn = yield* SessionNs.Service
            const info = yield* ssn.create({})
            yield* seedEdit({ sessionID: info.id, label: "turn-1", at: 1 })
            yield* seedEdit({ sessionID: info.id, label: "turn-2", at: 10, agentID: "explore-1" })
            return yield* execute({ scope: "tool", limit: 1 }, info.id)
          }).pipe(Effect.scoped, Effect.provide(env)),
        ),
    })

    expect(result.title).toBe("Tool edit history")
    expect(result.output).toContain("Recorded 1 recent tool edit entry")
    expect(result.output).toContain("explore-1")
    expect(result.output).toContain("/tmp/turn-2.ts")
    expect(result.metadata.count).toBe(1)
    expect(result.metadata.entries[0]?.agentID).toBe("explore-1")
    expect(result.metadata.entries[0]?.diffs[0]?.file).toBe("/tmp/turn-2.ts")
  })

  test("scope=session summarizes whole-session net diff", async () => {
    await using fixture = await tmpdir()
    const result = await Instance.provide({
      directory: fixture.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const ssn = yield* SessionNs.Service
            const info = yield* ssn.create({})
            yield* seedEdit({ sessionID: info.id, label: "turn-1", at: 1 })
            yield* seedEdit({ sessionID: info.id, label: "turn-2", at: 10 })
            return yield* execute({ scope: "session" }, info.id)
          }).pipe(Effect.scoped, Effect.provide(env)),
        ),
    })

    expect(result.title).toBe("Session edit history")
    expect(result.output).toContain("Recorded 2 changed files across this session.")
    expect(result.output).toContain("/tmp/turn-1.ts")
    expect(result.output).toContain("/tmp/turn-2.ts")
    expect(result.metadata.diffs?.map((item: { file: string }) => item.file)).toEqual([
      "/tmp/turn-1.ts",
      "/tmp/turn-2.ts",
    ])
  })
})
