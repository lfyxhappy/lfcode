import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import { CppTool } from "../../src/tool/cpp"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "../../src/plugin"
import { resolveCppCommand } from "../../src/cpp/runtime"
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

function initCpp() {
  return runtime.runPromise(CppTool.pipe(Effect.flatMap((info) => info.init())))
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

const compiler = resolveCppCommand()
let previousRuntime: ShellBackgroundRuntime | undefined

beforeEach(() => {
  previousRuntime = shellBackgroundRuntimeRef.current
  shellBackgroundRuntimeRef.current = {
    start: (input) => Effect.succeed({ id: "job_cpp_test", status: "running", source: input.source } as never),
    wait: () => Effect.succeed({ timedOut: true }),
    cancel: () => Effect.succeed({} as never),
    reattachRunningJobs: () => Effect.void,
  }
})

afterEach(() => {
  shellBackgroundRuntimeRef.current = previousRuntime
})

describe("tool.cpp", () => {
  test("builds a basic source file", async () => {
    if (!compiler) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const root = await fs.mkdtemp(path.join(__dirname, "cpp-build-"))
        const entry = path.join(root, "hello.cpp")
        await fs.writeFile(entry, '#include <iostream>\nint main(){ std::cout << "ok\\\\n"; }\n', "utf8")
        const tool = await initCpp()
        const result = await Effect.runPromise(
          tool.execute(
            {
              entry,
              mode: "build",
              description: "Build hello world",
            },
            ctx,
          ),
        )
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.metadata.outputPath).toBeTruthy()
        expect(result.output).toContain("Started durable C++ background job")
      },
    })
  })

  test("runs a basic source file", async () => {
    if (!compiler) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const root = await fs.mkdtemp(path.join(__dirname, "cpp-run-"))
        const entry = path.join(root, "hello.cpp")
        await fs.writeFile(entry, '#include <iostream>\nint main(){ std::cout << "ok\\\\n"; }\n', "utf8")
        const tool = await initCpp()
        const result = await Effect.runPromise(
          tool.execute(
            {
              entry,
              mode: "run",
              description: "Run hello world",
            },
            ctx,
          ),
        )
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.output).toContain("Started durable C++ background job")
      },
    })
  })

  test("uses timeout only as a background reminder threshold during run", async () => {
    if (!compiler) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const root = await fs.mkdtemp(path.join(__dirname, "cpp-timeout-"))
        const entry = path.join(root, "spin.cpp")
        await fs.writeFile(entry, "int main(){ return 0; }\n", "utf8")
        const tool = await initCpp()
        const result = await Effect.runPromise(
          tool.execute(
            {
              entry,
              mode: "run",
              timeout: 1000,
              description: "Run endless loop",
            },
            ctx,
          ),
        )
        expect(result.metadata.jobID).toBeTruthy()
        expect(result.metadata.status).toBe("running")
        expect(result.output).toContain("Started durable C++ background job")
      },
    })
  })
})
