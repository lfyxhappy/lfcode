import { Context, Effect, Layer } from "effect"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Database } from "../storage"
import { Config } from "../config"
import { reconcileMemory } from "./reconcile"
import { type ProjectMemoryWriteResult, writeProjectMemory } from "./write"
import { buildFtsQuery } from "./fts-query"
import fs from "fs/promises"

type SearchRow = {
  path: string
  scope: string
  scope_id: string
  type: string
  snippet: string
  score: number
}

const DEFAULT_MEMORY_SEARCH_STAGES = [
  ["memory", "project", "reference", "feedback", "user"],
  ["checkpoint", "progress", "notes"],
  ["free"],
] as const

export type MemoryCapability = {
  root_exists: boolean
  has_indexed_entries: boolean
  is_search_effective: boolean
}

export type MemorySearchResult =
  | {
      status: "unavailable"
      capability: MemoryCapability
      reason: "root-missing" | "index-empty" | "empty-query"
      results: []
    }
  | {
      status: "empty"
      capability: MemoryCapability
      reason: "no-match"
      results: []
    }
  | {
      status: "ok"
      capability: MemoryCapability
      results: Array<{ path: string; snippet: string; score: number; scope: string; scope_id: string; type: string }>
    }

export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly capability: () => Effect.Effect<MemoryCapability>
  readonly reconcile: () => Effect.Effect<{ indexed: number; pruned: number }>
  readonly writeProjectMemory: (input: {
    projectID: string
    key: string
    body: string
    summary?: string
  }) => Effect.Effect<ProjectMemoryWriteResult>
  readonly search: (input: {
    query: string
    scope?: string
    scope_id?: string
    type?: string
    path_prefix?: string
    limit?: number
  }) => Effect.Effect<MemorySearchResult>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Memory") {}

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const root = path.join(Global.Path.data, "memory")
    const ccBase = path.join(os.homedir(), ".claude", "projects")

    const rootEff = Effect.fn("Memory.root")(function* () {
      return root
    })

    const capability = Effect.fn("Memory.capability")(function* () {
      const rootExists = yield* Effect.promise(() =>
        fs
          .stat(root)
          .then((stat) => stat.isDirectory())
          .catch(() => false),
      )
      const indexed = Database.rawAll<{ count: number }>("SELECT COUNT(*) as count FROM memory_fts").at(0)?.count ?? 0
      return {
        root_exists: rootExists,
        has_indexed_entries: indexed > 0,
        is_search_effective: rootExists && indexed > 0,
      } satisfies MemoryCapability
    })

    const reconcile = Effect.fn("Memory.reconcile")(function* () {
      const cfg = yield* config.get()
      const cc = cfg.memory?.cc_index ? ccBase : undefined
      return yield* Effect.promise(() => reconcileMemory({ lfcode: root, cc }))
    })

    const search = Effect.fn("Memory.search")(function* (input: {
      query: string
      scope?: string
      scope_id?: string
      type?: string
      path_prefix?: string
      limit?: number
    }) {
      // Lazy reconcile before search (covers off-tool writes); honour config flag.
      const cfg = yield* config.get()
      const currentCapability = yield* capability()
      if (!currentCapability.root_exists) {
        return {
          status: "unavailable",
          capability: currentCapability,
          reason: "root-missing",
          results: [],
        } satisfies MemorySearchResult
      }

      if (cfg.checkpoint?.memory_reconcile_on_search ?? true) {
        const cc = cfg.memory?.cc_index ? ccBase : undefined
        yield* Effect.promise(() => reconcileMemory({ lfcode: root, cc }))
      }

      const postReconcileCapability = yield* capability()
      const limit = input.limit ?? 10
      // Build a token-level FTS5 query: punctuation becomes separators,
      // each alphanumeric run becomes a phrase-quoted literal, OR-joined.
      // See packages/lfcode/src/memory/fts-query.ts for the rationale.
      const ftsQuery = buildFtsQuery(input.query)
      if (!ftsQuery) {
        return {
          status: "unavailable",
          capability: postReconcileCapability,
          reason: "empty-query",
          results: [],
        } satisfies MemorySearchResult
      }
      if (!postReconcileCapability.has_indexed_entries) {
        return {
          status: "unavailable",
          capability: postReconcileCapability,
          reason: "index-empty",
          results: [],
        } satisfies MemorySearchResult
      }

      // OR-join means a doc matching only a common word (e.g. every
      // checkpoint.md matches "checkpoint") still matches, but BM25 ranks it
      // far below a doc matching several rare query words. We drop the
      // common-word noise with a RELATIVE floor: keep results scoring at
      // least `ratio` of the top hit's score. Relative (not absolute)
      // because BM25 magnitudes are corpus-size-dependent — in a tiny corpus
      // every score collapses toward 0 (low IDF), so any fixed absolute floor
      // would wrongly wipe real hits. The #1 result is ALWAYS kept (a match
      // is a match even when BM25 can't discriminate). Default 0.15.
      // Configurable; 0 disables (keep all matches).
      const floorRatio = cfg.checkpoint?.memory_search_score_floor ?? 0.15

      // Construct WHERE clauses for scope/scope_id/type filtering
      const conditions: string[] = []
      const params: string[] = []
      if (input.scope) {
        conditions.push("memory_fts.scope = ?")
        params.push(input.scope)
      }
      if (input.scope_id) {
        conditions.push("memory_fts.scope_id = ?")
        params.push(input.scope_id)
      }
      if (input.type) {
        conditions.push("memory_fts.type = ?")
        params.push(input.type)
      }
      if (input.path_prefix) {
        conditions.push("memory_fts.path LIKE ?")
        params.push(`${input.path_prefix}%`)
      }
      const explicitSearchBoundary = Boolean(input.scope || input.scope_id || input.type || input.path_prefix)
      const fetchLimit = Math.min(limit * 3, 50)
      const selectRows = (types?: readonly string[]) => {
        const scopedConditions = [...conditions]
        const scopedParams = [...params]
        if (types) {
          scopedConditions.push(`memory_fts.type IN (${types.map(() => "?").join(", ")})`)
          scopedParams.push(...types)
        }
        const whereClause = scopedConditions.length > 0 ? `AND ${scopedConditions.join(" AND ")}` : ""
        return Database.rawAll<SearchRow>(
          `
            SELECT memory_fts.path, memory_fts.scope, memory_fts.scope_id, memory_fts.type,
                   snippet(memory_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
                   bm25(memory_fts_idx) AS score
            FROM memory_fts_idx
            JOIN memory_fts ON memory_fts.id = memory_fts_idx.rowid
            WHERE memory_fts_idx MATCH ?
            ${whereClause}
            ORDER BY score
            LIMIT ?
          `,
          ftsQuery,
          ...scopedParams,
          fetchLimit,
        )
      }
      const mapRows = (rows: SearchRow[]) =>
        rows.map((row) => ({
          path: row.path,
          snippet: row.snippet,
          score: -row.score,
          scope: row.scope,
          scope_id: row.scope_id,
          type: row.type,
        }))
      const applyScoreFloor = (rows: ReturnType<typeof mapRows>) => {
        if (rows.length === 0) return rows
        const topScore = rows[0].score
        const cutoff = floorRatio > 0 ? topScore * floorRatio : -Infinity
        return rows.filter((row, index) => index === 0 || row.score >= cutoff)
      }
      const mapped = explicitSearchBoundary
        ? applyScoreFloor(mapRows(selectRows())).slice(0, limit)
        : DEFAULT_MEMORY_SEARCH_STAGES.flatMap((types) => applyScoreFloor(mapRows(selectRows(types)))).filter(
            (row, index, rows) => rows.findIndex((item) => item.path === row.path) === index,
          ).slice(0, limit)
      if (mapped.length === 0) {
        return {
          status: "empty",
          capability: postReconcileCapability,
          reason: "no-match",
          results: [],
        } satisfies MemorySearchResult
      }
      return {
        status: "ok",
        capability: postReconcileCapability,
        results: mapped,
      } satisfies MemorySearchResult
    })

    const writeProjectMemoryRecord = Effect.fn("Memory.writeProjectMemory")(function* (input: {
      projectID: string
      key: string
      body: string
      summary?: string
    }) {
      return yield* Effect.promise(() => writeProjectMemory(input, root))
    })

    return Service.of({
      root: rootEff,
      capability,
      reconcile,
      writeProjectMemory: writeProjectMemoryRecord,
      search,
    })
  }),
)

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Config.defaultLayer)))
