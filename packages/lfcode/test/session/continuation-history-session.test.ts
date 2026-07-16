import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { History } from "../../src/history"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { startScriptedLLMServer, textStopResponse } from "../lib/scripted-llm-server"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function run<A, E>(fx: Effect.Effect<A, E, SessionPrompt.Service | Session.Service | History.Service>) {
  return Effect.runPromise(
    fx.pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, History.defaultLayer)),
    ),
  )
}

function writeConfig(dir: string, origin: string) {
  return Bun.write(
    path.join(dir, "lfcode.json"),
    JSON.stringify({
      $schema: "https://lfcode.ai/config.json",
      enabled_providers: ["alibaba"],
      provider: {
        alibaba: {
          options: {
            apiKey: "test-key",
            baseURL: `${origin}/v1`,
          },
        },
      },
      agent: {
        build: {
          model: "alibaba/qwen-plus",
        },
      },
    }),
  )
}

describe("continuation context / history.session integration", () => {
  test("manual continue, loader recovery, and history.session stay consistent across a compaction boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("continued answer") }])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const history = yield* History.Service
              const session = yield* sessions.create({ title: "continuation-history-session" })

              const oldUser = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "old raw question" }],
              })
              if (oldUser.info.role !== "user") throw new Error("expected old user message")

              const oldAssistant = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: oldUser.info.id,
                role: "assistant" as const,
                sessionID: session.id,
                mode: "build",
                agent: "build",
                path: { cwd: tmp.path, root: tmp.path },
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
                modelID: oldUser.info.model.modelID,
                providerID: oldUser.info.model.providerID,
                time: { created: Date.now(), completed: Date.now() },
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: oldAssistant.id,
                sessionID: session.id,
                type: "text",
                text: "old raw answer",
              })

              const boundaryUser = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                role: "user" as const,
                sessionID: session.id,
                agentID: "main",
                time: { created: Date.now() + 1 },
                agent: "build",
                model: oldUser.info.model,
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: boundaryUser.id,
                sessionID: session.id,
                type: "compaction",
                auto: true,
              })

              const summaryAssistant = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: boundaryUser.id,
                role: "assistant" as const,
                sessionID: session.id,
                mode: "build",
                agent: "build",
                path: { cwd: tmp.path, root: tmp.path },
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
                modelID: oldUser.info.model.modelID,
                providerID: oldUser.info.model.providerID,
                time: { created: Date.now() + 2, completed: Date.now() + 2 },
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: summaryAssistant.id,
                sessionID: session.id,
                type: "text",
                text: "summary assistant body",
              })

              const continueUser = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "continue from latest context" }],
              })
              if (continueUser.info.role !== "user") throw new Error("expected continue user message")

              const continuation = yield* MessageV2.loadContinuationContextEffect(session.id, { agentID: "main" })
              expect(continuation.own.source).toBe("compaction")
              expect(continuation.own.boundary).toMatchObject({
                messageID: boundaryUser.id,
                kind: "compaction",
                valid: true,
              })
              expect(continuation.own.messages.map((message) => message.info.id)).toEqual([
                boundaryUser.id,
                summaryAssistant.id,
                continueUser.info.id,
              ])

              const snapshot = yield* history.session({
                session_id: session.id,
                agent_scope: "main",
                include_boundaries: true,
              })
              expect(snapshot.session_found).toBe(true)
              expect(snapshot.checkpoint_found).toBe(false)
              expect(snapshot.messages.map((message) => message.message_id)).toEqual([
                oldUser.info.id,
                oldAssistant.id,
                boundaryUser.id,
                summaryAssistant.id,
                continueUser.info.id,
              ])
              expect(JSON.stringify(snapshot.messages)).toContain("old raw question")
              expect(JSON.stringify(snapshot.messages)).toContain("old raw answer")
              expect(JSON.stringify(snapshot.messages)).toContain("summary assistant body")

              const result = yield* prompt.loop({
                sessionID: session.id,
                agentID: "main",
              })

              expect(result.info.role).toBe("assistant")
              expect(result.parts.some((part) => part.type === "text" && part.text === "continued answer")).toBe(true)
              expect(stub.captures.length).toBe(1)
              const requestMessages = JSON.stringify(stub.captures[0]?.messages ?? [])
              expect(requestMessages).toContain("Summary of previous conversation:")
              expect(requestMessages).toContain("summary assistant body")
              expect(requestMessages).toContain("continue from latest context")
              expect(requestMessages).not.toContain("old raw question")
              expect(requestMessages).not.toContain("old raw answer")
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })
})
