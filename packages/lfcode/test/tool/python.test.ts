import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PythonTool } from "../../src/tool/python"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "../../src/plugin"
import { resolveBasePythonCommand } from "../../src/python/runtime"
import { Instance } from "../../src/project/instance"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppFileSystem.defaultLayer, Plugin.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

function initPython() {
  return runtime.runPromise(PythonTool.pipe(Effect.flatMap((info) => info.init())))
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const python = resolveBasePythonCommand()

describe("tool.python", () => {
  test("executes a basic script", async () => {
    if (!python) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initPython()
        const result = await Effect.runPromise(
          tool.execute(
            {
              code: "print('ok')",
              description: "Print ok",
            },
            ctx,
          ),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.python).toBeTruthy()
        expect(result.output).toContain("ok")
      },
    })
  })

  test("reports timeout explicitly", async () => {
    if (!python) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initPython()
        const result = await Effect.runPromise(
          tool.execute(
            {
              code: ["import time", "time.sleep(5)"].join("\n"),
              timeout: 100,
              description: "Sleep too long",
            },
            ctx,
          ),
        )
        expect(result.metadata.timedOut).toBe(true)
        expect(result.output).toContain("timed out after 100ms")
      },
    })
  })

  test("adds a dependency hint for missing modules", async () => {
    if (!python) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initPython()
        const result = await Effect.runPromise(
          tool.execute(
            {
              code: "import lfcode_missing_module_12345",
              description: "Import missing module",
            },
            ctx,
          ),
        )
        expect(result.metadata.exit).not.toBe(0)
        expect(result.output).toContain("Missing dependency detected")
        expect(result.output).toContain("lfcode_missing_module_12345")
      },
    })
  })
})
