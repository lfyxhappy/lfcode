import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Bus } from "../../src/bus"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

const makeAssistant = (
  sessionID: MessageV2.Assistant["sessionID"],
  parentID: MessageV2.Assistant["parentID"],
  dir: string,
  time: MessageV2.Assistant["time"],
): MessageV2.Assistant => ({
  id: MessageID.ascending(),
  role: "assistant",
  sessionID,
  mode: "default",
  agent: "default",
  path: { cwd: path.resolve(dir), root: path.resolve(dir) },
  cost: 0,
  tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  modelID: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  parentID,
  time,
})

describe("sweepOrphanAssistants", () => {
  it.live("updates hidden reviewer orphans without publishing their contents", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 10_000 },
        })
        const reviewer = yield* sessions.updateMessage({
          ...makeAssistant(session.id, user.id, dir, { created: Date.now() - 5_000 }),
          agentID: "context-reviewer-1",
        })
        const published: MessageV2.Info[] = []
        const unsub = Bus.subscribe(MessageV2.Event.Updated, (event) => published.push(event.properties.info))

        yield* Effect.sync(() => Session.clearOrphanAssistants({ sessionID: session.id, minAgeMs: 0 }))
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)))
        unsub()

        const stored = yield* sessions.messages({ sessionID: session.id, agentID: "*" })
        expect((stored.find((item) => item.info.id === reviewer.id)?.info as MessageV2.Assistant | undefined)?.time.completed).toBeDefined()
        expect(published.map((info) => info.id)).not.toContain(reviewer.id)
      }),
    ),
  )

  it.live("marks an assistant message older than 60s as completed with AbortedError", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 7_300_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 7_200_000 })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.role).toBe("assistant")
        expect(info.time.completed).toBeDefined()
        expect(info.time.completed!).toBeGreaterThanOrEqual(now)
        expect(info.error).toBeDefined()
        expect(JSON.stringify(info.error)).toContain("Abandoned")
      }),
    ),
  )

  it.live("leaves a recent (under 60s) incomplete assistant message untouched", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 1_900_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 1_800_000 })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBeUndefined()
        expect(info.error).toBeUndefined()
      }),
    ),
  )

  it.live("can clear a recent incomplete assistant when requested explicitly", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 10_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 5_000 })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id, {
          minAgeMs: 0,
          message: "Interrupted: previous request was stopped because Lfcode restarted",
        })

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBeDefined()
        expect(JSON.stringify(info.error)).toContain("Lfcode restarted")
      }),
    ),
  )

  it.live("clears recent incomplete assistants by directory during startup cleanup", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 10_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 5_000 })
        yield* sessions.updateMessage(assistant)

        yield* Effect.sync(() =>
          Session.clearOrphanAssistants({
            directory: dir,
            minAgeMs: 0,
            message: "Interrupted: previous request was stopped because Lfcode restarted",
          }),
        )

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBeDefined()
        expect(JSON.stringify(info.error)).toContain("Lfcode restarted")
      }),
    ),
  )

  it.live("leaves an already-completed assistant message untouched", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 7_300_000 },
        })

        const now = Date.now()
        const originalCompleted = now - 7_200_000
        const assistant = makeAssistant(session.id, userMsg.id, dir, {
          created: now - 7_200_000,
          completed: originalCompleted,
        })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBe(originalCompleted)
        expect(info.error).toBeUndefined()
      }),
    ),
  )
})
