import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { RuntimeManageTool } from "../../src/tool/runtime_manage"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { recordRuntimeOperationLog, runtimeOperationLogPath } from "../../src/runtime-registry"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const runtime = ManagedRuntime.make(Layer.mergeAll(Plugin.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))

function initRuntimeManage() {
  return runtime.runPromise(RuntimeManageTool.pipe(Effect.flatMap((info) => info.init())))
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

afterEach(() => {
  rmSync(runtimeOperationLogPath(), { force: true })
  delete process.env.LFCODE_MANAGED_PYTHON_PATH
})

describe("tool.runtime_manage", () => {
  test("lists runtime items", async () => {
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initRuntimeManage()
        const result = await Effect.runPromise(
          tool.execute(
            {
              action: "list",
              description: "List runtime status",
            },
            ctx,
          ),
        )
        expect(result.metadata.action).toBe("list")
        expect(result.output).toContain("Python 受管环境")
      },
    })
  })

  test("returns recent runtime logs", async () => {
    await recordRuntimeOperationLog({
      id: "python-managed",
      action: "repair",
      status: "success",
      title: "Python 受管环境修复",
      message: "Python 受管环境已检查并修复。",
    })

    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initRuntimeManage()
        const result = await Effect.runPromise(
          tool.execute(
            {
              action: "logs",
              id: "python-managed",
              limit: 5,
              description: "Read runtime logs",
            },
            ctx,
          ),
        )
        expect(result.output).toContain("Python 受管环境修复")
      },
    })
  })

  test("requires id for install", async () => {
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initRuntimeManage()
        await expect(
          Effect.runPromise(
            tool.execute(
              {
                action: "install",
                description: "Install runtime",
              },
              ctx,
            ),
          ),
        ).rejects.toThrow("requires an id")
      },
    })
  })

  test("repairs an existing managed python path", async () => {
    const root = path.join(tmpdir(), `lfcode-runtime-tool-${process.pid}-${Date.now()}`)
    const pythonPath = path.join(root, process.platform === "win32" ? "python.exe" : "python")
    mkdirSync(path.dirname(pythonPath), { recursive: true })
    await Bun.write(pythonPath, "")
    process.env.LFCODE_MANAGED_PYTHON_PATH = pythonPath

    try {
      await Instance.provide({
        directory: __dirname,
        fn: async () => {
          const tool = await initRuntimeManage()
          const result = await Effect.runPromise(
            tool.execute(
              {
                action: "repair",
                id: "python-managed",
                description: "Repair Python runtime",
              },
              ctx,
            ),
          )
          expect(result.output).toContain("Python 受管环境已检查并修复。")
          expect(result.output).toContain(pythonPath)
        },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("installing unsupported runtime surfaces the failure", async () => {
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const tool = await initRuntimeManage()
        await expect(
          Effect.runPromise(
            tool.execute(
              {
                action: "install",
                id: "python-base",
                description: "Install Python base runtime",
              },
              ctx,
            ),
          ),
        ).rejects.toThrow("does not support managed install yet")
      },
    })
  })
})
