import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PipTool } from "../../src/tool/pip"
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
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.python).toBeTruthy()
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
