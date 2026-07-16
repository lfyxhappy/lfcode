import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Storage } from "../../src/storage"
import { Session as SessionNs } from "../../src/session"
import { SessionSummary } from "../../src/session/summary"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Log } from "../../src/util"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

void Log.init({ print: false })

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionSummary.layer.pipe(
    Layer.provide(SessionNs.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

const it = testEffect(env)

describe("SessionSummary.summarize main-slice contract", () => {
  it.live(
    "computeDiff anchors come only from main-slice step-finish parts",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})

        // Main user → main asst (tool metadata diff should be retained).
        const userID = MessageID.ascending()
        yield* ssn.updateMessage({
          id: userID,
          role: "user" as const,
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: userID,
          sessionID: info.id,
          type: "text",
          text: "do thing",
        })
        const mainAsstID = MessageID.ascending()
        yield* ssn.updateMessage({
          id: mainAsstID,
          role: "assistant" as const,
          sessionID: info.id,
          agentID: "main",
          agent: "build",
          mode: "primary",
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: userID,
          time: { created: Date.now() + 1, completed: Date.now() + 2 },
          finish: "end_turn",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          path: { cwd: "/", root: "/" },
          cost: 0,
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: mainAsstID,
          sessionID: info.id,
          type: "tool",
          tool: "edit",
          callID: "call-main",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "",
            metadata: {
              files: [
                {
                  file: "snap-main-to",
                  patch: "",
                  additions: 1,
                  deletions: 0,
                  status: "modified",
                },
              ],
            },
            time: { start: Date.now() + 1, end: Date.now() + 2 },
          },
        } as never)

        // Subagent on the SAME sessionID with its own tool diff.
        // If summarize ever includes subagent messages, this file name leaks in.
        const subUserID = MessageID.ascending()
        yield* ssn.updateMessage({
          id: subUserID,
          role: "user" as const,
          sessionID: info.id,
          agentID: "explore-1",
          agent: "explore",
          model: ref,
          time: { created: Date.now() + 3 },
        })
        const subAsstID = MessageID.ascending()
        yield* ssn.updateMessage({
          id: subAsstID,
          role: "assistant" as const,
          sessionID: info.id,
          agentID: "explore-1",
          agent: "explore",
          mode: "default",
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: subUserID,
          time: { created: Date.now() + 4, completed: Date.now() + 5 },
          finish: "end_turn",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          path: { cwd: "/", root: "/" },
          cost: 0,
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: subAsstID,
          sessionID: info.id,
          type: "tool",
          tool: "edit",
          callID: "call-sub",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "",
            metadata: {
              files: [
                {
                  file: "snap-sub-to",
                  patch: "",
                  additions: 1,
                  deletions: 0,
                  status: "modified",
                },
              ],
            },
            time: { start: Date.now() + 4, end: Date.now() + 5 },
          },
        } as never)

        const summary = yield* SessionSummary.Service
        yield* summary.summarize({ sessionID: info.id, messageID: userID })
        const sessionInfo = yield* ssn.get(info.id)
        const refreshed = yield* ssn.messages({ sessionID: info.id, agentID: "*" })
        const target = refreshed.find((item) => item.info.id === userID)
        expect(target?.info.role).toBe("user")
        const summaryDiffs = target?.info.summary as { diffs?: { file: string; patch: string }[] } | undefined
        expect(summaryDiffs?.diffs?.map((item) => item.file)).toEqual(["snap-main-to"])
        expect(summaryDiffs?.diffs?.map((item) => item.patch)).toEqual([""])
        expect(sessionInfo.summary?.files).toBe(1)
        expect(sessionInfo.summary?.additions).toBe(1)
        expect(sessionInfo.summary?.deletions).toBe(0)
      }),
    ),
  )
})
