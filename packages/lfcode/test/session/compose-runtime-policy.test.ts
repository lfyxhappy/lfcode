import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { resolveComposeRuntimePolicy } from "../../src/session/compose-runtime-policy"
import { TaskRegistry } from "../../src/task/registry"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { startScriptedLLMServer, textStopResponse } from "../lib/scripted-llm-server"

void Log.init({ print: false })

afterEach(async () => {
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

function toolNames(capture: { body: Record<string, unknown> }) {
  const tools = Array.isArray(capture.body.tools) ? capture.body.tools : []
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return []
    const fn = (tool as { function?: { name?: unknown } }).function
    return typeof fn?.name === "string" ? [fn.name] : []
  })
}

describe("compose runtime policy", () => {
  test("strategy matrix maps to hard runtime behavior", () => {
    expect(
      resolveComposeRuntimePolicy({
        sourceMessageID: "m1" as never,
        summary: "",
        taskType: "small-feature",
        difficulty: "simple",
        strategy: "direct-execute",
        executionShape: "single-shot",
        requiresTaskBoard: false,
        requiresPlan: false,
        requiresReview: false,
        requiresVerify: false,
        reason: "",
        time: { created: 1, updated: 1 },
      }),
    ).toMatchObject({
      requireWorkflow: false,
      allowParallelActors: false,
      allowWorkflowTool: false,
      allowTaskTool: false,
    })
    expect(
      resolveComposeRuntimePolicy({
        sourceMessageID: "m2" as never,
        summary: "",
        taskType: "investigation",
        difficulty: "moderate",
        strategy: "research-then-execute",
        executionShape: "research-first",
        requiresTaskBoard: false,
        requiresPlan: true,
        requiresReview: false,
        requiresVerify: false,
        reason: "",
        time: { created: 1, updated: 1 },
      }),
    ).toMatchObject({
      requireWorkflow: false,
      allowParallelActors: false,
      allowWorkflowTool: true,
      allowTaskTool: false,
    })
    expect(
      resolveComposeRuntimePolicy({
        sourceMessageID: "m3" as never,
        summary: "",
        taskType: "design",
        difficulty: "complex",
        strategy: "design-then-execute",
        executionShape: "design-first",
        requiresTaskBoard: false,
        requiresPlan: true,
        requiresReview: false,
        requiresVerify: false,
        reason: "",
        time: { created: 1, updated: 1 },
      }),
    ).toMatchObject({
      requireWorkflow: false,
      allowParallelActors: false,
      allowWorkflowTool: true,
      allowTaskTool: false,
    })
    expect(
      resolveComposeRuntimePolicy({
        sourceMessageID: "m4" as never,
        summary: "",
        taskType: "large-project",
        difficulty: "very-complex",
        strategy: "full-orchestration",
        executionShape: "multi-workstream",
        requiresTaskBoard: true,
        requiresPlan: true,
        requiresReview: true,
        requiresVerify: true,
        reason: "",
        time: { created: 1, updated: 1 },
      }),
    ).toMatchObject({
      requireWorkflow: true,
      allowParallelActors: true,
      allowWorkflowTool: true,
      allowTaskTool: true,
    })
  })

  test("direct-execute strips actor workflow and task from the real LLM request", async () => {
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
              const session = yield* sessions.create({ title: "compose-direct-policy" })

              yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [{ type: "text", text: "修复一个局部按钮颜色问题。" }],
              })

              const updated = yield* sessions.get(session.id)
              expect(updated.composeRoute?.strategy).toBe("direct-execute")
              const names = toolNames(stub.captures[0]!)
              expect(names).not.toContain("actor")
              expect(names).not.toContain("workflow")
              expect(names).not.toContain("task")
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("full-orchestration keeps actor workflow and task in the real LLM request", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = startScriptedLLMServer([
      {
        lines: textStopResponse("Plan: split the migration. Review: checked for drift. Verification: bun test."),
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
              const tasks = yield* TaskRegistry.Service
              const session = yield* sessions.create({ title: "compose-heavy-policy" })
              const seed = yield* tasks.create({ session_id: session.id, summary: "seed task board" })
              yield* tasks.done({ session_id: session.id, id: seed.id })

              yield* prompt.prompt({
                sessionID: session.id,
                agent: "compose",
                parts: [
                  {
                    type: "text",
                    text: "并行梳理 packages/app、packages/lfcode、packages/desktop 三个模块的迁移方案并执行验证。",
                  },
                ],
              })

              const updated = yield* sessions.get(session.id)
              expect(updated.composeRoute?.strategy).toBe("full-orchestration")
              const names = toolNames(stub.captures[0]!)
              expect(names).toContain("actor")
              expect(names).toContain("workflow")
              expect(names).toContain("task")
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })
})
