import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PipTool } from "../../src/tool/pip"
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

function initPip() {
  return runtime.runPromise(PipTool.pipe(Effect.flatMap((info) => info.init())))
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

beforeEach(() => {
  previousRuntime = shellBackgroundRuntimeRef.current
  shellBackgroundRuntimeRef.current = {
    start: (input) => Effect.succeed({ id: "job_pip_test", status: "running", source: input.source } as never),
    wait: () => Effect.succeed({ timedOut: true }),
    cancel: () => Effect.succeed({} as never),
    reattachRunningJobs: () => Effect.void,
  }
})

afterEach(() => {
  shellBackgroundRuntimeRef.current = previousRuntime
})

describe("tool.pip", () => {
  test(
    "lists installed packages",
    async () => {
      if (!python) return
      await Instance.provide({
        directory: __dirname,
        fn: async () => {
        const tool = await initPip()
        const result = await Effect.runPromise(
          tool.execute(
            {
              action: "list",
              description: "List Python packages",
            },
            ctx,
          ),
        )
          expect(result.metadata.jobID).toBeTruthy()
          expect(result.metadata.status).toBe("running")
          expect(result.metadata.python).toBeTruthy()
          expect(result.output).toContain("Started durable pip background job")
        },
      })
    },
    30000,
  )

  test("requires packages for install-like actions", async () => {
    if (!python) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initPip()
        await expect(
          Effect.runPromise(
            tool.execute(
              {
                action: "install",
                description: "Install missing package",
              },
              ctx,
            ),
          ),
        ).rejects.toThrow("requires at least one package")
      },
    })
  })
})
