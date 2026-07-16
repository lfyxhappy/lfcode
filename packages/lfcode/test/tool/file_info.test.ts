import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { AppFileSystem } from "@/filesystem"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { Truncate } from "../../src/tool"
import { FileInfoTool } from "../../src/tool/file_info"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const init = Effect.fn("FileInfoToolTest.init")(function* () {
  const info = yield* FileInfoTool
  return yield* info.init()
})

describe("file_info tool", () => {
  it.live("returns lightweight metadata for a text file", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        yield* fs.writeWithDirs(path.join(dir, "hello.txt"), "hello world")
        const tool = yield* init()
        const result = yield* tool.execute({ path: path.join(dir, "hello.txt") }, ctx)
        expect(result.output).toContain("<exists>true</exists>")
        expect(result.output).toContain("<binary>false</binary>")
        expect(result.metadata.kind).toBe("file")
        expect(result.metadata.isBinary).toBe(false)
      }),
    ),
  )
})
