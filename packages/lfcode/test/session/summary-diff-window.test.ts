import { describe, expect } from "bun:test"
import { mkdirSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage"
import { Session as SessionNs } from "../../src/session"
import { SessionSummary } from "../../src/session/summary"
import { Vcs } from "../../src/project"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Log } from "../../src/util"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

void Log.init({ print: false })

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  Vcs.defaultLayer,
  Storage.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionSummary.layer.pipe(
    Layer.provide(SessionNs.defaultLayer),
    Layer.provide(Vcs.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

const it = testEffect(env)

const seedTurn = Effect.fn("seedTurn")(function* (input: {
  sessionID: SessionID
  label: string
  at: number
  dir: string
}) {
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
  yield* Effect.promise(() => Bun.write(path.join(input.dir, "turn.txt"), input.label))
  yield* ssn.updateMessage({
    id: assistantID,
    role: "assistant" as const,
    sessionID: input.sessionID,
    agentID: "main",
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
            file: `${input.label}.txt`,
            patch: "",
            additions: 1,
            deletions: 0,
            status: "modified",
          },
        ],
      },
      time: { start: input.at + 1, end: input.at + 2 },
    },
  } as never)

  return {
    userID,
    file: `${input.label}.txt`,
  }
})

describe("SessionSummary.diff turn windows", () => {
  it.live(
    "turns=1 returns only the latest main turn diff",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1, dir })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10, dir })
        const third = yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20, dir })

        const diff = yield* summary.diff({ sessionID: info.id, turns: 1 })
        expect(diff.map((item) => item.file)).toEqual([third.file])
      }),
    ),
  )

  it.live(
    "turns=15 spans the full available turn window",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1, dir })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10, dir })
        yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20, dir })

        const diff = yield* summary.diff({ sessionID: info.id, turns: 15 })
        expect(diff.map((item) => item.file)).toEqual(["turn-1.txt", "turn-2.txt", "turn-3.txt"])
      }),
    ),
  )

  it.live(
    "messageID plus turns=1 targets the requested turn",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1, dir })
        const second = yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10, dir })
        yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20, dir })

        const diff = yield* summary.diff({ sessionID: info.id, messageID: second.userID, turns: 1 })
        expect(diff.map((item) => item.file)).toEqual([second.file])
      }),
    ),
  )

  it.live(
    "without turns it still returns the stored full-session diff",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const storage = yield* Storage.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1, dir })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10, dir })
        const third = yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20, dir })

        yield* summary.summarize({ sessionID: info.id, messageID: third.userID })
        yield* storage.write(["session_diff", info.id], [
          {
            file: "turn.txt",
            patch: "",
            additions: 1,
            deletions: 0,
            status: "modified",
          },
        ])
        const diff = yield* summary.diff({ sessionID: info.id })
        expect(diff.map((item) => item.file)).toEqual(["turn.txt"])
      }),
    ),
  )

  it.live(
    "without turns skips oversized stored full-session diff files",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})
        const dir = path.join(Global.Path.data, "storage", "session_diff")
        mkdirSync(dir, { recursive: true })
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, `${info.id}.json`),
            JSON.stringify([
              {
                file: "huge.txt",
                patch: "x".repeat(9 * 1024 * 1024),
                additions: 1,
                deletions: 0,
                status: "modified",
              },
            ]),
          ),
        )

        const diff = yield* summary.diff({ sessionID: info.id })
        const sessionDiff = yield* ssn.diff(info.id)
        expect(diff).toEqual([])
        expect(sessionDiff).toEqual([])
      }),
    ),
  )
})
