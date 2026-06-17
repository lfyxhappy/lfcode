import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Storage } from "../../src/storage"
import { Snapshot } from "../../src/snapshot"
import { Session as SessionNs } from "../../src/session"
import { SessionSummary } from "../../src/session/summary"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Log } from "../../src/util"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

void Log.init({ print: false })

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const snapshotStub = Layer.succeed(
  Snapshot.Service,
  Snapshot.Service.of({
    init: () => Effect.void,
    cleanup: () => Effect.void,
    track: () => Effect.succeed(undefined),
    patch: () => Effect.succeed({ hash: "", files: [] }),
    restore: () => Effect.void,
    revert: () => Effect.void,
    diff: () => Effect.succeed(""),
    diffFull: (from, to) =>
      Effect.succeed([
        {
          file: `${from}->${to}`,
          patch: "",
          additions: 1,
          deletions: 0,
          status: "modified" as const,
        },
      ]),
  }),
)

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionSummary.layer.pipe(
    Layer.provide(SessionNs.defaultLayer),
    Layer.provide(snapshotStub),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

const it = testEffect(env)

const seedTurn = Effect.fn("seedTurn")(function* (input: { sessionID: SessionID; label: string; at: number }) {
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
    type: "step-start",
    snapshot: `${input.label}-from`,
  } as never)
  yield* ssn.updatePart({
    id: PartID.ascending(),
    messageID: assistantID,
    sessionID: input.sessionID,
    type: "step-finish",
    snapshot: `${input.label}-to`,
  } as never)

  return {
    userID,
    file: `${input.label}-from->${input.label}-to`,
  }
})

describe("SessionSummary.diff turn windows", () => {
  it.live(
    "turns=1 returns only the latest main turn diff",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1 })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10 })
        const third = yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20 })

        const diff = yield* summary.diff({ sessionID: info.id, turns: 1 })
        expect(diff.map((item) => item.file)).toEqual([third.file])
      }),
    ),
  )

  it.live(
    "turns=15 spans the full available turn window",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1 })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10 })
        yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20 })

        const diff = yield* summary.diff({ sessionID: info.id, turns: 15 })
        expect(diff.map((item) => item.file)).toEqual(["turn-1-from->turn-3-to"])
      }),
    ),
  )

  it.live(
    "messageID plus turns=1 targets the requested turn",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1 })
        const second = yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10 })
        yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20 })

        const diff = yield* summary.diff({ sessionID: info.id, messageID: second.userID, turns: 1 })
        expect(diff.map((item) => item.file)).toEqual([second.file])
      }),
    ),
  )

  it.live(
    "without turns it still returns the stored full-session diff",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const summary = yield* SessionSummary.Service
        const info = yield* ssn.create({})

        yield* seedTurn({ sessionID: info.id, label: "turn-1", at: 1 })
        yield* seedTurn({ sessionID: info.id, label: "turn-2", at: 10 })
        const third = yield* seedTurn({ sessionID: info.id, label: "turn-3", at: 20 })

        yield* summary.summarize({ sessionID: info.id, messageID: third.userID })
        const diff = yield* summary.diff({ sessionID: info.id })
        expect(diff.map((item) => item.file)).toEqual(["turn-1-from->turn-3-to"])
      }),
    ),
  )
})
