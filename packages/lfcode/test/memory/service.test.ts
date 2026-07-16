import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Database } from "../../src/storage"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { MemoryFtsTable } from "../../src/memory/fts.sql"
import { Memory } from "../../src/memory"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  // Clear shared in-memory DB rows so tests don't bleed into each other.
  Database.use((db) => db.delete(MemoryFtsTable).run())
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Memory.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("Memory.search", () => {
  it.live("returns unavailable when the memory root does not exist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))

        const result = yield* memory.search({ query: "JWT" })
        expect(result.status).toBe("unavailable")
        if (result.status !== "unavailable") throw new Error(`expected unavailable result, got ${result.status}`)
        expect(result.reason).toBe("root-missing")
      }),
    ),
  )

  it.live("returns BM25-ranked matches across all scopes when no scope filter", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "global", "auth.md"), "JWT signing with RS256 algorithm"),
        )
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "global", "perf.md"), "database query optimization tips"),
        )

        const results = yield* memory.search({ query: "JWT" })
        expect(results.status).toBe("ok")
        expect(results.results.length).toBe(1)
        expect(results.results[0].path).toContain("auth.md")
        expect(results.results[0].score).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("filters by scope", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "sessions/ses_a"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "x.md"), "matching content"))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "sessions/ses_a", "x.md"), "matching content"))

        const globalOnly = yield* memory.search({ query: "matching", scope: "global" })
        expect(globalOnly.status).toBe("ok")
        expect(globalOnly.results.length).toBe(1)
        expect(globalOnly.results[0].path.replace(/\\/g, "/")).toContain("/global/")

        const sessionOnly = yield* memory.search({ query: "matching", scope: "sessions" })
        expect(sessionOnly.status).toBe("ok")
        expect(sessionOnly.results.length).toBe(1)
        expect(sessionOnly.results[0].path.replace(/\\/g, "/")).toContain("/sessions/")
      }),
    ),
  )

  it.live("filters by scope_id when scope is sessions", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "sessions/ses_a"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "sessions/ses_b"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "sessions/ses_a", "x.md"), "alpha content"))
        yield* Effect.promise(() => fs.writeFile(path.join(root, "sessions/ses_b", "x.md"), "alpha content"))

        const aOnly = yield* memory.search({ query: "alpha", scope: "sessions", scope_id: "ses_a" })
        expect(aOnly.status).toBe("ok")
        expect(aOnly.results.length).toBe(1)
        expect(aOnly.results[0].path).toContain("ses_a")
      }),
    ),
  )

  it.live("respects limit", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        for (let i = 0; i < 15; i++) {
          yield* Effect.promise(() => fs.writeFile(path.join(root, "global", `f${i}.md`), `match ${i}`))
        }

        const r5 = yield* memory.search({ query: "match", limit: 5 })
        expect(r5.status).toBe("ok")
        expect(r5.results.length).toBe(5)
      }),
    ),
  )

  it.live("filters by path_prefix without disturbing result ordering", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "projects/global"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "projects/global", "MEMORY-provider.md"), "provider normalization model alias routing"),
        )
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "projects/global", "MEMORY-desktop.md"), "desktop packaging sync use copy"),
        )
        yield* Effect.promise(() => fs.writeFile(path.join(root, "global", "auth.md"), "provider normalization secrets"))

        const results = yield* memory.search({
          query: "provider normalization",
          scope: "projects",
          scope_id: "global",
          path_prefix: path.join(root, "projects", "global") + path.sep,
          limit: 5,
        })
        expect(results.status).toBe("ok")
        expect(results.results.length).toBeGreaterThanOrEqual(1)
        expect(results.results.every((item) => item.path.startsWith(path.join(root, "projects", "global") + path.sep))).toBe(true)
        expect(results.results[0].path).toContain("MEMORY-provider.md")
      }),
    ),
  )

  it.live("does not crash on FTS5 special chars in query", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "global", "x.md"), 'literal "quoted" content with stars'),
        )

        // Each of these contains a char that would crash the FTS5 MATCH parser
        // if the query were not phrase-wrapped: `"`, `*`, `(`, prefix `-`.
        for (const q of ['"quoted"', "wild*", "(paren)", "-not", "and"]) {
          const results = yield* memory.search({ query: q })
          expect(["ok", "empty", "unavailable"]).toContain(results.status)
        }
      }),
    ),
  )

  it.live("multi-word query OR-matches across tokens, splits punctuation", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "global"), { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(root, "global", "doc.md"),
            "T5.3 closure conversion abandoned — out of v0.1 scope per spec.md §4.4",
          ),
        )
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "global", "other.md"), "unrelated text only"),
        )

        // Identifier with dot: tokenizer splits T5.3 into [t5, 3]; OR-join +
        // BM25 ranks doc.md (which contains both + "closure") top.
        const dotted = yield* memory.search({ query: "T5.3 closure" })
        expect(dotted.status).toBe("ok")
        expect(dotted.results.length).toBeGreaterThanOrEqual(1)
        expect(dotted.results[0].path).toContain("doc.md")

        // Multi-word: both words appear in doc.md, other.md has neither →
        // only doc.md is above the score floor.
        const both = yield* memory.search({ query: "abandoned scope" })
        expect(both.status).toBe("ok")
        expect(both.results.length).toBe(1)
        expect(both.results[0].path).toContain("doc.md")

        // OR semantics: one word present ("abandoned"), one absent
        // ("nonexistentterm") → still matches doc.md (unlike old AND, which
        // returned 0). This is the recall fix: a stray non-matching word no
        // longer zeroes the query.
        const orHit = yield* memory.search({ query: "abandoned nonexistentterm" })
        expect(orHit.status).toBe("ok")
        expect(orHit.results.length).toBe(1)
        expect(orHit.results[0].path).toContain("doc.md")

        // A query of ONLY absent words → genuinely 0.
        const trueMiss = yield* memory.search({ query: "nonexistentterm anotherbogusword" })
        expect(trueMiss.status).toBe("empty")
        expect(trueMiss.results.length).toBe(0)

        // Empty query returns empty array (early-return path).
        const empty = yield* memory.search({ query: "   " })
        expect(empty.status).toBe("unavailable")
        if (empty.status !== "unavailable") throw new Error(`expected unavailable result, got ${empty.status}`)
        expect(empty.reason).toBe("empty-query")
      }),
    ),
  )

  it.live("prefers durable memory before session checkpoint and scratch noise for default search", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const memory = yield* Memory.Service
        const root = yield* memory.root()
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "projects/p1"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "sessions/s1"), { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "projects/p1", "MEMORY.md"), "browser session keepalive should restore the last side panel state"),
        )
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "sessions/s1", "checkpoint.md"), "browser session browser session browser session"),
        )
        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "sessions/s1", "notes.md"), "browser browser browser scratchpad"),
        )

        const results = yield* memory.search({ query: "browser session", limit: 3 })
        expect(results.status).toBe("ok")
        expect(results.results[0].path).toContain(path.join("projects", "p1", "MEMORY.md"))
        expect(results.results.some((item) => item.path.includes(path.join("sessions", "s1", "checkpoint.md")))).toBe(true)
      }),
    ),
  )
})
