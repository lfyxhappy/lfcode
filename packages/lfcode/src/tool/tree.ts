import path from "path"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Glob } from "@lfcode-ai/shared/util/glob"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"

type Node = {
  name: string
  absolute: string
  type: "file" | "directory"
  children?: Node[]
}

type TreeStats = {
  files: number
  directories: number
}

export const TreeTool = Tool.define(
  "tree",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const load = (
      root: string,
      depth: number,
      include: string[] | undefined,
      ignore: string[] | undefined,
      level = 0,
    ): Effect.Effect<Node[]> =>
      Effect.gen(function* () {
        if (level > depth) return []
        const entries = yield* fs.readDirectoryEntries(root).pipe(Effect.catch(() => Effect.succeed([])))
        const nodes = yield* Effect.forEach(
          entries.toSorted((a, b) => a.name.localeCompare(b.name)),
          (entry): Effect.Effect<Node | undefined> =>
            Effect.gen(function* () {
              const absolute = path.join(root, entry.name)
              const relative = absolute.replaceAll("\\", "/")
              const ignored = ignore?.some((pattern) => Glob.match(pattern, relative)) ?? false
              if (ignored) return undefined
              const isDirectory = entry.type === "directory"
              const matchesInclude =
                !include ||
                include.length === 0 ||
                include.some((pattern) => Glob.match(pattern, relative) || Glob.match(pattern, entry.name))
              const children = isDirectory ? yield* load(absolute, depth, include, ignore, level + 1) : undefined
              if (!matchesInclude && (!children || children.length === 0)) return undefined
              return {
                name: entry.name,
                absolute,
                type: isDirectory ? "directory" : "file",
                children,
              }
            }),
          { concurrency: "unbounded" },
        )
        return nodes.filter((item): item is Node => item !== undefined)
      })

    const render = (nodes: Node[], indent = ""): string[] =>
      nodes.flatMap((node, index) => {
        const last = index === nodes.length - 1
        const branch = `${indent}${last ? "└─ " : "├─ "}${node.name}${node.type === "directory" ? "/" : ""}`
        if (!node.children || node.children.length === 0) return [branch]
        return [branch, ...render(node.children, `${indent}${last ? "   " : "│  "}`)]
      })

    const count = (nodes: Node[]): TreeStats =>
      nodes.reduce(
        (acc, node) => ({
          files: acc.files + (node.type === "file" ? 1 : 0) + (node.children ? count(node.children).files : 0),
          directories:
            acc.directories + (node.type === "directory" ? 1 : 0) + (node.children ? count(node.children).directories : 0),
        }),
        { files: 0, directories: 0 },
      )

    return {
      description:
        "Show a hierarchical directory tree. Use this when you need project structure instead of a flat directory listing.",
      parameters: z.object({
        path: z.string().optional().describe("Directory to inspect. Defaults to the current working directory."),
        depth: z.coerce.number().optional().describe("Maximum directory depth to include. Defaults to 3."),
        include: z.array(z.string()).optional().describe("Optional glob filters to keep matching paths."),
        ignore: z.array(z.string()).optional().describe("Optional glob filters to exclude matching paths."),
      }),
      execute: (params: { path?: string; depth?: number; include?: string[]; ignore?: string[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const search = path.isAbsolute(params.path ?? SessionCwd.get(ctx.sessionID))
            ? (params.path ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.path ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(search) : search

          yield* assertExternalDirectoryEffect(ctx, normalized, { kind: "directory" })
          yield* ctx.ask({
            permission: "glob",
            patterns: [normalized],
            always: ["*"],
            metadata: {
              depth: params.depth,
              include: params.include,
              ignore: params.ignore,
            },
          })

          const info = yield* fs.stat(normalized).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info || info.type !== "Directory") throw new Error(`tree path must be a directory: ${normalized}`)

          const nodes = yield* load(normalized, Math.max(0, params.depth ?? 3), params.include, params.ignore)
          const stats = count(nodes)
          return {
            title: path.basename(normalized) || normalized,
            output: [
              `<path>${normalized}</path>`,
              "<type>tree</type>",
              ...render(nodes),
              "",
              `(${stats.directories} directories, ${stats.files} files)`,
            ].join("\n"),
            metadata: {
              directories: stats.directories,
              files: stats.files,
              truncated: false,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
