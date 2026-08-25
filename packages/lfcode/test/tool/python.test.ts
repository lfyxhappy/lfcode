import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PythonTool } from "../../src/tool/python"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "../../src/plugin"
import { resolveBasePythonCommand } from "../../src/python/runtime"
import { Instance } from "../../src/project/instance"
import { shellBackgroundRuntimeRef } from "../../src/background-job/runtime-ref"
import type { Interface as ShellBackgroundRuntime } from "../../src/background-job/runtime"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
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
let previousRuntime: ShellBackgroundRuntime | undefined
let starts: Array<{ argv?: string[]; files?: { name: string; content: string }[] }> = []

beforeEach(() => {
  previousRuntime = shellBackgroundRuntimeRef.current
  starts = []
  shellBackgroundRuntimeRef.current = {
    start: (input) => {
      starts.push(input)
      return Effect.succeed({ id: "job_python_test", status: "running", source: input.source } as never)
    },
    wait: () => Effect.succeed({ timedOut: true }),
    cancel: () => Effect.succeed({} as never),
    reattachRunningJobs: () => Effect.void,
  }
})

afterEach(() => {
  shellBackgroundRuntimeRef.current = previousRuntime
})

describe("tool.python", () => {
  test("starts a basic script as a durable background job", async () => {
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
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.metadata.python).toBeTruthy()
        expect(result.output).toContain("Started tracked Python shell process")
        expect(starts).toHaveLength(1)
        expect(starts[0]?.argv?.at(-1)).toBe("{jobRoot}/script.py")
        expect(starts[0]?.files).toEqual([{ name: "script.py", content: "print('ok')" }])
      },
    })
  })

  test("uses timeout only as a background reminder threshold", async () => {
    if (!python) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initPython()
        const result = await Effect.runPromise(
          tool.execute(
            {
              code: ["import time", "time.sleep(0.2)"].join("\n"),
              timeout: 100,
              description: "Sleep too long",
            },
            ctx,
          ),
        )
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.output).toContain("tracked Python shell process")
      },
    })
  })

  test("starts module checks through the same process pool", async () => {
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
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.output).toContain("tracked Python shell process")
      },
    })
  })
})
