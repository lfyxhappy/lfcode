import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { startScriptedLLMServer, textStopResponse } from "../lib/scripted-llm-server"

void Log.init({ print: false })
const integrationTimeout = { timeout: 15000 }

afterEach(async () => {
  await Instance.disposeAll()
})

function run<A, E>(fx: Effect.Effect<A, E, SessionPrompt.Service | Session.Service>) {
  return Effect.runPromise(
    fx.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer))),
  )
}

function writeConfig(dir: string, origin: string) {
  return Bun.write(
    path.join(dir, "lfcode.json"),
    JSON.stringify({
      $schema: "https://lfcode.ai/config.json",
      enabled_providers: ["alibaba"],
      provider: {
        alibaba: { options: { apiKey: "test-key", baseURL: `${origin}/v1` } },
      },
      agent: { build: { model: "alibaba/qwen-plus" } },
    }),
  )
}

describe("interrupted-output continuation — integration", () => {
  test("pre-existing missing-finish-step assistant is auto-resumed instead of being treated as a terminal failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("final answer") }])
    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "interrupted-output" })
              const user = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "继续当前任务" }],
              })
              if (user.info.role !== "user") throw new Error("expected user message")

              const interrupted = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: user.info.id,
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
                modelID: user.info.model.modelID,
                providerID: user.info.model.providerID,
                time: { created: Date.now() },
                error: new MessageV2.ModelError({
                  message: "The model stream ended before a completion event was received.",
                }).toObject(),
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-start",
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-finish",
                reason: "missing-finish-step",
                status: "error",
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              })

              const result = yield* prompt.loop({
                sessionID: session.id,
                agentID: "main",
              })

              expect(stub.captures.length).toBe(1)
              expect(result.info.role).toBe("assistant")
              if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
              expect(result.parts.some((part) => part.type === "text" && part.text === "final answer")).toBe(true)
              const msgs = yield* sessions.messages({ sessionID: session.id })
              expect(
                msgs.some(
                  (msg) =>
                    msg.info.role === "user" &&
                    msg.parts.some(
                      (part) =>
                        part.type === "text" &&
                        part.synthetic &&
                        part.text.includes("interrupted before the model emitted a completion event"),
                    ),
                ),
              ).toBe(true)
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  }, integrationTimeout)

  test("pre-existing interrupted assistant with completed tool results auto-resumes even without missing-finish-step sentinel", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("final answer after tool result") }])
    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "interrupted-output-tool-result" })
              const user = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "继续刚才基于工具结果的任务" }],
              })
              if (user.info.role !== "user") throw new Error("expected user message")

              const interrupted = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: user.info.id,
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
                modelID: user.info.model.modelID,
                providerID: user.info.model.providerID,
                time: { created: Date.now() },
                error: new MessageV2.ModelError({
                  message: "The model stream ended before a completion event was received.",
                }).toObject(),
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-start",
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "tool",
                callID: "call-read-1",
                tool: "read",
                state: {
                  status: "completed",
                  input: { filePath: `${tmp.path}/README.md` },
                  output: "README CONTENT",
                  title: "Read README",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-finish",
                reason: "ModelError",
                status: "error",
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              })

              const result = yield* prompt.loop({
                sessionID: session.id,
                agentID: "main",
              })

              expect(stub.captures.length).toBe(1)
              expect(result.info.role).toBe("assistant")
              if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
              expect(result.parts.some((part) => part.type === "text" && part.text === "final answer after tool result")).toBe(true)
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  }, integrationTimeout)

  test("pre-existing MessageAbortedError with completed tool results also auto-resumes", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("final answer after aborted tool result") }])
    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "interrupted-output-aborted-tool-result" })
              const user = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "继续刚才被中断的工具结果" }],
              })
              if (user.info.role !== "user") throw new Error("expected user message")

              const interrupted = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: user.info.id,
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
                modelID: user.info.model.modelID,
                providerID: user.info.model.providerID,
                time: { created: Date.now() },
                error: new MessageV2.AbortedError({
                  message: "Aborted",
                }).toObject(),
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-start",
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "tool",
                callID: "call-read-2",
                tool: "read",
                state: {
                  status: "completed",
                  input: { filePath: `${tmp.path}/README.md` },
                  output: "README CONTENT",
                  title: "Read README",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-finish",
                reason: "MessageAbortedError",
                status: "error",
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              })

              const result = yield* prompt.loop({
                sessionID: session.id,
                agentID: "main",
              })

              expect(stub.captures.length).toBe(1)
              expect(result.info.role).toBe("assistant")
              if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
              expect(
                result.parts.some((part) => part.type === "text" && part.text === "final answer after aborted tool result"),
              ).toBe(true)
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  }, integrationTimeout)

  test("pre-existing ModelError without usable output does not auto-resume", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("should not be called") }])
    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "interrupted-output-hard-failure" })
              const user = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "继续这个失败回合" }],
              })
              if (user.info.role !== "user") throw new Error("expected user message")

              const interrupted = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                parentID: user.info.id,
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
                modelID: user.info.model.modelID,
                providerID: user.info.model.providerID,
                time: { created: Date.now() },
                error: new MessageV2.ModelError({
                  message: "The model stream ended before a completion event was received.",
                }).toObject(),
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-start",
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: interrupted.id,
                sessionID: session.id,
                type: "step-finish",
                reason: "ModelError",
                status: "error",
                cost: 0,
                tokens: {
                  total: 0,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              })

              const result = yield* prompt.loop({
                sessionID: session.id,
                agentID: "main",
              })

              expect(stub.captures.length).toBe(0)
              expect(result.info.role).toBe("assistant")
              if (result.info.role === "assistant") {
                expect(result.info.error?.name).toBe("ModelError")
              }
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  }, integrationTimeout)
})
