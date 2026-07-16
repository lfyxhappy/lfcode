import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@/filesystem"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool"
import { TreeTool } from "../../src/tool/tree"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer),
)

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

const init = Effect.fn("TreeToolTest.init")(function* () {
  const info = yield* TreeTool
  return yield* info.init()
})

describe("tree tool", () => {
  it.live("renders a directory tree with include and ignore filters", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "app.ts"), "export {}\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "app.test.ts"), "test()\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "assets", "logo.svg"), "<svg />\n"))
        const tool = yield* init()
        const result = yield* tool.execute(
          {
            path: dir,
            depth: 2,
            include: ["*.ts"],
            ignore: ["**/*.test.ts"],
          },
          ctx,
        )

        expect(result.output).toContain("src/")
        expect(result.output).toContain("app.ts")
        expect(result.output).not.toContain("app.test.ts")
        expect(result.output).not.toContain("logo.svg")
        expect(result.metadata.files).toBe(1)
      }),
    ),
  )
})
