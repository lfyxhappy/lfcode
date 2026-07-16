import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskRegistry } from "../../src/task/registry"
import { Log } from "../../src/util"
import { workflowRef } from "../../src/workflow/runtime-ref"
import { tmpdir } from "../fixture/fixture"
import { startScriptedLLMServer, textStopResponse, toolCallResponse } from "../lib/scripted-llm-server"

void Log.init({ print: false })

afterEach(async () => {
  workflowRef.current = undefined
  await Instance.disposeAll()
})

function run<A, E>(fx: Effect.Effect<A, E, SessionPrompt.Service | Session.Service | TaskRegistry.Service>) {
  return Effect.runPromise(
    fx.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, TaskRegistry.defaultLayer))),
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
        compose: {
          model: "alibaba/qwen-plus",
        },
      },
    }),
  )
}

describe("compose route-aware gates", () => {
  test("plain text planning without a settled design boundary does not satisfy the design gate", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([
      { lines: textStopResponse("done.") },
      { lines: textStopResponse("Plan: define the interface first, then implement it.") },
      { lines: textStopResponse("Plan: define the interface first, then implement it.") },
      { lines: textStopResponse("Plan: define the interface first, then implement it.") },
    ])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "compose-plan-gate" })

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "先设计一个模块接口再实现，给出最终实现结果。" }],
              })

              const updated = yield* sessions.get(session.id)
              expect(updated.composeRoute?.strategy).toBe("design-then-execute")
              expect(updated.composeRoute?.requiresPlan).toBe(true)
              expect(stub.captures.length).toBeGreaterThanOrEqual(5)
              const capturedMessages = stub.captures.map((capture) => JSON.stringify(capture.messages))
              expect(capturedMessages.some((messages) => messages.includes("complete the missing compose stages"))).toBe(true)
              expect(
                capturedMessages.some((messages) =>
                  messages.includes(
                    "settle the design boundary first with a concrete design/plan summary before broad implementation",
                  ),
                ),
              ).toBe(true)
              expect(result.info.role).toBe("assistant")
              if (result.info.role !== "assistant") throw new Error(`expected assistant result, got ${result.info.role}`)
              expect(result.info.error?.name).toBe("ModelError")
              expect(JSON.stringify(result.info.error)).toContain("Compose route requirements are still incomplete")
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("simple compose routes bypass task-board enforcement even if stale tasks exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([{ lines: textStopResponse("fixed.") }])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const tasks = yield* TaskRegistry.Service
              const session = yield* sessions.create({ title: "compose-light-route" })
              yield* tasks.create({ session_id: session.id, summary: "stale heavy task" })

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "修复一个局部按钮颜色问题。" }],
              })

              const updated = yield* sessions.get(session.id)
              const messages = yield* sessions.messages({ sessionID: session.id })
              expect(updated.composeRoute?.strategy).toBe("direct-execute")
              expect(updated.composeRoute?.requiresTaskBoard).toBe(false)
              expect(stub.captures.length).toBe(1)
              expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
              expect(result.info.role).toBe("assistant")
              expect(result.parts.some((part) => part.type === "text" && part.text.includes("fixed."))).toBe(true)
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("lightweight investigation evidence satisfies research-first compose without orchestrator", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([
      {
        lines: textStopResponse(
          [
            "调查结论：我检查了当前行为、相关文件和日志，问题来自重复的滚动恢复链路。",
            "计划：删掉重复恢复 effect，保留像素恢复主链，再做最小验证。",
          ].join("\n"),
        ),
      },
    ])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* sessions.create({ title: "compose-light-research" })

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "先查明这个问题的真实原因，再决定怎么修。" }],
              })

              const updated = yield* sessions.get(session.id)
              expect(updated.composeRoute?.strategy).toBe("research-then-execute")
              expect(stub.captures.length).toBe(1)
              expect(result.info.role).toBe("assistant")
              if (result.info.role !== "assistant") throw new Error(`expected assistant result, got ${result.info.role}`)
              expect(result.info.error).toBeUndefined()
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("full orchestration cannot finish on text-only plan review verify claims", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([
      { lines: textStopResponse("Plan: split the migration. Review: checked. Verification: bun test.") },
      { lines: textStopResponse("Plan: split the migration. Review: checked. Verification: bun test.") },
      { lines: textStopResponse("Plan: split the migration. Review: checked. Verification: bun test.") },
      { lines: textStopResponse("Plan: split the migration. Review: checked. Verification: bun test.") },
    ])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const tasks = yield* TaskRegistry.Service
              const session = yield* sessions.create({ title: "compose-heavy-gate" })
              const seed = yield* tasks.create({ session_id: session.id, summary: "seed task board" })
              yield* tasks.done({ session_id: session.id, id: seed.id })

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。" }],
              })

              expect(stub.captures.length).toBe(4)
              expect(JSON.stringify(stub.captures[1]?.messages ?? [])).toContain(
                "prefer the built-in compose-orchestrator workflow, or provide equivalent staged evidence for plan, review, and verify",
              )
              expect(result.info.role).toBe("assistant")
              if (result.info.role !== "assistant") throw new Error(`expected assistant result, got ${result.info.role}`)
              expect(result.info.error?.name).toBe("ModelError")
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("full orchestration completes after compose-orchestrator notification delivers structured evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([
      {
        lines: toolCallResponse({
          id: "call_compose_workflow",
          name: "workflow",
          args: JSON.stringify({
            operation: "run",
            name: "compose-orchestrator",
            args: "并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。",
          }),
        }),
      },
      { lines: textStopResponse("workflow finished and the compose route requirements are satisfied.") },
    ])

    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              workflowRef.current = {
                start: (input) =>
                  Effect.gen(function* () {
                    const history = yield* sessions.messages({ sessionID: input.sessionID, agentID: "main" })
                    const lastRealUser = [...history]
                      .reverse()
                      .find(
                        (message): message is MessageV2.WithParts & { info: MessageV2.User } =>
                          message.info.role === "user" &&
                          !message.parts.every((part) => "synthetic" in part && part.synthetic),
                      )
                    if (!lastRealUser) return yield* Effect.die("expected a real user message before workflow notification")
                    const msgID = MessageID.ascending()
                    yield* sessions.updateMessage({
                      id: msgID,
                      role: "user",
                      sessionID: input.sessionID,
                      agentID: input.parentActorID ?? "main",
                      time: { created: Date.now() },
                      agent: lastRealUser?.info.agent ?? "compose",
                      model: lastRealUser?.info.model,
                    })
                    yield* sessions.updatePart({
                      id: PartID.ascending(),
                      messageID: msgID,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text:
                        "Workflow completed. run_id: wf_compose_test\n" +
                        JSON.stringify({
                          inspect: {
                            summary: "inspection done",
                            files: ["packages/app/src/a.tsx"],
                            symbols: ["renderPanel"],
                            tests: ["packages/app/test/a.test.ts"],
                            evidence: ["runtime log"],
                          },
                          route: {
                            strategy: "full-orchestration",
                            executionShape: "multi-workstream",
                          },
                          plan: {
                            summary: "plan ready",
                            workstreams: [{ id: "W1", title: "one" }],
                            verification: ["bun test"],
                          },
                          execute: ["done"],
                          review: {
                            passed: true,
                            summary: "review ok",
                            drift: [],
                            gaps: [],
                          },
                          verify: {
                            passed: true,
                            summary: "verify ok",
                            evidence: ["bun test passed"],
                            remaining: [],
                          },
                        }),
                    })
                    return { runID: "wf_compose_test" }
                  }),
                status: () => Effect.succeed({ status: "completed", agentCount: 0 }),
                wait: () => Effect.succeed({ status: "completed", result: {} }),
                cancel: () => Effect.void,
                list: () => Effect.succeed([]),
                resume: () => Effect.succeed({ runID: "wf_compose_test", resumed: false }),
              }

              const prompt = yield* SessionPrompt.Service
              const tasks = yield* TaskRegistry.Service
              const session = yield* sessions.create({ title: "compose-heavy-success" })
              const seed = yield* tasks.create({ session_id: session.id, summary: "seed task board" })
              yield* tasks.done({ session_id: session.id, id: seed.id })

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。" }],
              })

              const messages = yield* sessions.messages({ sessionID: session.id, agentID: "main" })
              expect(stub.captures.length).toBeGreaterThanOrEqual(2)
              expect(result.info.role).toBe("assistant")
              if (result.info.role !== "assistant") throw new Error(`expected assistant result, got ${result.info.role}`)
              expect(result.info.error).toBeUndefined()
              expect(
                messages.some(
                  (message) =>
                    message.info.role === "user" &&
                    message.parts.some(
                      (part) =>
                        part.type === "text" &&
                        part.synthetic === true &&
                        part.text.includes("Workflow completed. run_id: wf_compose_test"),
                    ),
                ),
              ).toBe(true)
              expect(
                messages.some((message) =>
                  message.parts.some(
                    (part) =>
                      part.type === "tool" &&
                      part.tool === "workflow" &&
                      part.state.status === "completed" &&
                      part.state.input.name === "compose-orchestrator",
                  ),
                ),
              ).toBe(true)
            }),
          ),
      })
    } finally {
      workflowRef.current = undefined
      await stub.stop()
    }
  })
})
