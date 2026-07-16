import { describe, expect, test } from "bun:test"
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

const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppFileSystem.defaultLayer, Plugin.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
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
        expect(result.metadata.compileExit).toBe(0)
        expect(result.metadata.outputPath).toBeTruthy()
        await fs.access(result.metadata.outputPath)
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
        expect(result.metadata.compileExit).toBe(0)
        expect(result.metadata.runExit).toBe(0)
        expect(result.output).toContain("## Compile")
        expect(result.output).toContain("## Run")
        expect(result.output).toContain("ok")
      },
    })
  })

  test("reports timeout explicitly during run", async () => {
    if (!compiler) return
    await Instance.provide({
      directory: __dirname,
      fn: async () => {
        const root = await fs.mkdtemp(path.join(__dirname, "cpp-timeout-"))
        const entry = path.join(root, "spin.cpp")
        await fs.writeFile(entry, "int main(){ for(;;){} }\n", "utf8")
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
        expect(result.metadata.compileExit).toBe(0)
        expect(result.metadata.timedOut).toBe(true)
        expect(result.output).toContain("Timed out after 1000ms")
      },
    })
  })
})
