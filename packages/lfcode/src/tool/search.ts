import path from "path"
import z from "zod"
import fuzzysort from "fuzzysort"
import { Effect, Stream } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Ripgrep } from "../file/ripgrep"
import * as Tool from "./tool"
import { GrepTool } from "./grep"
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
    const grepInfo = yield* GrepTool
    const grep = yield* grepInfo.init()

    const definition: Tool.DefWithoutID<typeof Parameters, SearchMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { kind: "path" | "content"; query: string; path?: string; include?: string; limit?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.kind === "content") {
            return yield* grep.execute(
              {
                pattern: params.query,
                path: params.path,
                include: params.include,
              },
              ctx,
            )
          }

          const cwd = path.isAbsolute(params.path ?? SessionCwd.get(ctx.sessionID))
            ? (params.path ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.path ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(cwd) : cwd
          const info = yield* fs.stat(normalized).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) throw new Error(`search path does not exist: ${normalized}`)

          yield* assertExternalDirectoryEffect(ctx, normalized, { kind: info.type === "Directory" ? "directory" : "file" })
          yield* ctx.ask({
            permission: "glob",
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
