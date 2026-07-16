import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Memory } from "../../src/memory"
import { MemoryFtsTable } from "../../src/memory/fts.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage"
import { MemoryTool } from "../../src/tool/memory"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  Database.use((db) => db.delete(MemoryFtsTable).run())
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Memory.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
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

describe("memory tool", () => {
  it.live("search operation returns formatted results", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "auth.md"), "JWT signing notes"))

        const info = yield* MemoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "search", query: "JWT" }, ctx)

        expect(result.output).toContain("auth.md")
      }),
    ),
  )

  it.live("search operation with missing memory root returns unavailable state", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))

        const info = yield* MemoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "search", query: "nonexistent" }, ctx)

        expect(result.output).toContain("Memory is not currently usable")
      }),
    ),
  )

  it.live("search operation with available memory but no hit returns bounded no-match guidance", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "auth.md"), "JWT signing notes"))

        const info = yield* MemoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "search", query: "nonexistent" }, ctx)

        expect(result.output).toContain("Memory is available, but this query did not hit anything indexed.")
        expect(result.output).not.toContain("Widen scope progressively")
      }),
    ),
  )

  it.live("accepts legacy operation object with search key", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "gallery.md"), "MultiBundleRoot notes"))

        const info = yield* MemoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: { search: "" }, query: "MultiBundleRoot" } as never,
          ctx,
        )

        expect(result.output).toContain("gallery.md")
      }),
    ),
  )

  it.live("accepts legacy nested query shape", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "manifest.md"), "incremental append 30431"))

        const info = yield* MemoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute(
          { operation: { action: "search", query: "30431" } } as never,
          ctx,
        )

        expect(result.output).toContain("manifest.md")
      }),
    ),
  )
})
