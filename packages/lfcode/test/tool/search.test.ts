import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@/filesystem"
import { Ripgrep } from "../../src/file/ripgrep"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { SearchTool } from "../../src/tool/search"
import { Truncate } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
  ),
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

const init = Effect.fn("SearchToolTest.init")(function* () {
  const info = yield* SearchTool
  return yield* info.init()
})

describe("search tool", () => {
  it.live("supports path search with relative scope", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "search-me.ts"), "export const value = 1\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "ignore.txt"), "plain text\n"))
        const tool = yield* init()
        const result = yield* tool.execute(
          {
            kind: "path",
            query: "search-me",
            path: "src",
            include: "*.ts",
          },
          ctx,
        )

        expect(result.output).toContain(path.join(dir, "src", "search-me.ts"))
        expect(result.output).not.toContain("ignore.txt")
        expect((result.metadata as { count?: number }).count).toBe(1)
      }),
    ),
  )

  it.live("supports content search via the unified facade", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "alpha.ts"), "const alpha = 1\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "src", "beta.ts"), "const beta = alpha + 1\n"))
        const tool = yield* init()
        const result = yield* tool.execute(
          {
            kind: "content",
            query: "alpha",
            path: "src",
            include: "*.ts",
          },
          ctx,
        )

        expect(result.output).toContain("Found")
        expect(result.output).toContain("alpha.ts")
        expect("matches" in result.metadata ? (result.metadata.matches ?? 0) : 0).toBeGreaterThan(0)
      }),
    ),
  )
})
