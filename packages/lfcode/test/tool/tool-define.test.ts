import { describe, test, expect } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import z from "zod"
import { Agent } from "../../src/agent/agent"
import { Tool } from "../../src/tool"
import { Truncate } from "../../src/tool"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const params = z.object({ input: z.string() })

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    execute() {
      executeFn?.()
      return Effect.succeed({ title: "test", output: "ok", metadata: {} })
    },
  }
}

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const info = await runtime.runPromise(Tool.define("test-tool", Effect.succeed(original)))

    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())

    expect(original.execute).toBe(originalExecute)
  })

  test("effect-defined tool returns fresh objects and is unaffected", async () => {
    const info = await runtime.runPromise(
      Tool.define(
        "test-fn-tool",
        Effect.succeed(() => Effect.succeed(makeTool("test"))),
      ),
    )

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const info = await runtime.runPromise(Tool.define("test-copy", Effect.succeed(makeTool("test"))))

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("runs pre, guard, post, finalizer, and result observer in order", async () => {
    const events: string[] = []
    const disposePre = Tool.registerPreExecuteHook(() => {
      events.push("pre")
    })
    const disposeGuard = Tool.registerExecutionGuard(() => {
      events.push("guard")
      return undefined
    })
    const disposePost = Tool.registerPostExecuteHook(({ result }) => {
      events.push("post")
      return { ...result, output: "post" }
    })
    const disposeObserver = Tool.registerResultObserver(() => events.push("result"))
    try {
      const info = await runtime.runPromise(
        Tool.define(
          "pipeline-tool",
          Effect.succeed({
            ...makeTool("pipeline"),
            execute: () => {
              events.push("execute")
              return Effect.succeed({ title: "test", output: "body", metadata: { truncated: false } })
            },
            finalizeContent: (result) => {
              events.push("finalize")
              return { ...result, output: `${result.output}-final` }
            },
          }),
        ),
      )
      const def = await Effect.runPromise(info.init())
      const result = await Effect.runPromise(
        def.execute({ input: "ok" }, { sessionID: "ses" as any, messageID: "msg" as any, agent: "build", abort: new AbortController().signal, messages: [], metadata: () => Effect.void, ask: () => Effect.void }),
      )
      expect(result.output).toBe("post-final")
      expect(events).toEqual(["pre", "guard", "execute", "post", "finalize", "result"])
    } finally {
      disposePre()
      disposeGuard()
      disposePost()
      disposeObserver()
    }
  })

  test("reports a failed settlement to result observers exactly once", async () => {
    const outcomes: Tool.ToolExecutionOutcome[] = []
    const disposeObserver = Tool.registerResultObserver(({ outcome }) => outcomes.push(outcome))
    try {
      const info = await runtime.runPromise(
        Tool.define(
          "failed-pipeline-tool",
          Effect.succeed({ ...makeTool("failed"), execute: () => Effect.fail(new Error("boom")) as never }),
        ),
      )
      const def = await Effect.runPromise(info.init())
      await expect(
        Effect.runPromise(
          def.execute({ input: "ok" }, { sessionID: "ses" as any, messageID: "msg" as any, agent: "build", abort: new AbortController().signal, messages: [], metadata: () => Effect.void, ask: () => Effect.void }),
        ),
      ).rejects.toThrow("boom")
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]?.type).toBe("failure")
    } finally {
      disposeObserver()
    }
  })
})
