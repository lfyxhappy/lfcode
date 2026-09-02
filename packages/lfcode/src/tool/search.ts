import path from "path"
import z from "zod"
import fuzzysort from "fuzzysort"
import { Effect, Stream } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Ripgrep } from "../file/ripgrep"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./search.txt"

const Parameters = z.object({
  kind: z.enum(["path", "content"]).describe("Search file paths or file contents."),
  query: z.string().describe("Search query. For content search this is a regex pattern."),
  path: z.string().optional().describe("Directory or file scope. Defaults to the current working directory."),
  include: z.string().optional().describe('Optional file glob, for example "*.ts" or "*.{ts,tsx}".'),
  limit: z.coerce.number().optional().describe("Maximum number of path results to return. Defaults to 100."),
})

type SearchMetadata = {
  count?: number
  matches?: number
  truncated: boolean
}

export const SearchTool = Tool.define(
  "search",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service

    const definition: Tool.DefWithoutID<typeof Parameters, SearchMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { kind: "path" | "content"; query: string; path?: string; include?: string; limit?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.kind === "content") {
            if (!params.query) throw new Error("search query is required")
            const effectiveCwd = SessionCwd.get(ctx.sessionID)
            const search = AppFileSystem.resolve(
              path.isAbsolute(params.path ?? effectiveCwd)
                ? (params.path ?? effectiveCwd)
                : path.join(effectiveCwd, params.path ?? "."),
            )
            const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const cwd = info?.type === "Directory" ? search : path.dirname(search)
            const file = info?.type === "Directory" ? undefined : [path.relative(cwd, search)]
            yield* assertExternalDirectoryEffect(ctx, search, {
              kind: info?.type === "Directory" ? "directory" : "file",
            })
            yield* ctx.ask({
              permission: "search",
              patterns: [params.query],
              always: ["*"],
              metadata: { path: search, include: params.include },
            })
            const result = yield* rg.search({
              cwd,
              pattern: params.query,
              glob: params.include ? [params.include] : undefined,
              file,
              signal: ctx.abort,
            })
            const limit = Math.max(1, params.limit ?? 100)
            const rows = result.items.slice(0, limit).map((item) => ({
              path: AppFileSystem.resolve(path.isAbsolute(item.path.text) ? item.path.text : path.join(cwd, item.path.text)),
              line: item.line_number,
              text: item.lines.text,
            }))
            return {
              title: params.query,
              output:
                rows.length === 0
                  ? "No files found"
                  : [`Found ${rows.length} matches`, ...rows.map((row) => `${row.path}:${row.line}: ${row.text}`)].join("\n"),
              metadata: { matches: rows.length, truncated: result.partial || result.items.length > rows.length },
            }
          }

          const cwd = path.isAbsolute(params.path ?? SessionCwd.get(ctx.sessionID))
            ? (params.path ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.path ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(cwd) : cwd
          const info = yield* fs.stat(normalized).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) throw new Error(`search path does not exist: ${normalized}`)

          yield* assertExternalDirectoryEffect(ctx, normalized, { kind: info.type === "Directory" ? "directory" : "file" })
          yield* ctx.ask({
            permission: "search",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              path: normalized,
              include: params.include,
            },
          })

          const limit = Math.max(1, params.limit ?? 100)
          const files = info.type === "Directory"
            ? yield* rg.files({
                cwd: normalized,
                glob: params.include ? [params.include] : undefined,
                signal: ctx.abort,
              }).pipe(Stream.runCollect, Effect.map((chunk) => [...chunk]))
            : [path.basename(normalized)]
          const ranked = params.query.trim()
            ? fuzzysort.go(params.query, files, { limit }).map((item) => item.target)
            : files.slice(0, limit)
          const output =
            ranked.length === 0
              ? ["No paths found"]
              : ranked.map((item) => (info.type === "Directory" ? path.join(normalized, item) : normalized))
          return {
            title: params.query || path.basename(normalized),
            output: output.join("\n"),
            metadata: {
              count: ranked.length,
              truncated: files.length > ranked.length,
            },
          }
        }).pipe(Effect.orDie),
    }
    return definition
  }),
)
