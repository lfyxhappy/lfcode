import { NodeFileSystem } from "@effect/platform-node"
import { realpathSync } from "fs"
import { readdir } from "fs/promises"
import { lookup } from "mime-types"
import path from "path"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { Glob } from "@lfcode-ai/shared/util/glob"

export namespace AppFileSystem {
  export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()("FileSystemError", {
    method: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export type Error = PlatformError | FileSystemError

  export interface DirEntry {
    readonly name: string
    readonly type: "file" | "directory" | "symlink" | "other"
  }

  export interface Interface extends FileSystem.FileSystem {
    readonly isDir: (path: string) => Effect.Effect<boolean>
    readonly isFile: (path: string) => Effect.Effect<boolean>
    readonly existsSafe: (path: string) => Effect.Effect<boolean>
    readonly readJson: (path: string) => Effect.Effect<unknown, Error>
    readonly writeJson: (path: string, data: unknown, mode?: number) => Effect.Effect<void, Error>
    readonly ensureDir: (path: string) => Effect.Effect<void, Error>
    readonly writeWithDirs: (path: string, content: string | Uint8Array, mode?: number) => Effect.Effect<void, Error>
    readonly readDirectoryEntries: (path: string) => Effect.Effect<DirEntry[], Error>
    readonly findUp: (target: string, start: string, stop?: string) => Effect.Effect<string[], Error>
    readonly up: (options: { targets: string[]; start: string; stop?: string }) => Effect.Effect<string[], Error>
    readonly globUp: (pattern: string, start: string, stop?: string) => Effect.Effect<string[], Error>
    readonly glob: (pattern: string, options?: Glob.Options) => Effect.Effect<string[], Error>
    readonly globMatch: (pattern: string, filepath: string) => boolean
  }

  export class Service extends Context.Service<Service, Interface>()("@lfcode/FileSystem") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const raw = yield* FileSystem.FileSystem
      const fs = Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
          key,
          typeof value === "function"
            ? (...args: unknown[]) =>
                // NodeFileSystem currently returns effect objects that are runnable but not directly yieldable here.
                Effect.suspend(() => (value as (...args: unknown[]) => unknown).call(raw, ...args) as never)
            : value,
        ]),
      ) as FileSystem.FileSystem

      const existsSafe = Effect.fn("FileSystem.existsSafe")(function* (target: string) {
        return yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
      })

      const isDir = Effect.fn("FileSystem.isDir")(function* (target: string) {
        const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.void))
        return info?.type === "Directory"
      })

      const isFile = Effect.fn("FileSystem.isFile")(function* (target: string) {
        const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.void))
        return info?.type === "File"
      })

      const readDirectoryEntries = Effect.fn("FileSystem.readDirectoryEntries")(function* (dirPath: string) {
        return yield* Effect.tryPromise({
          try: async () => {
            const entries = await readdir(dirPath, { withFileTypes: true })
            return entries.map(
              (entry): DirEntry => ({
                name: entry.name,
                type: entry.isDirectory()
                  ? "directory"
                  : entry.isSymbolicLink()
                    ? "symlink"
                    : entry.isFile()
                      ? "file"
                      : "other",
              }),
            )
          },
          catch: (cause) => new FileSystemError({ method: "readDirectoryEntries", cause }),
        })
      })

      const readJson = Effect.fn("FileSystem.readJson")(function* (target: string) {
        const text = yield* fs.readFileString(target)
        return JSON.parse(text)
      })

      const writeJson = Effect.fn("FileSystem.writeJson")(function* (target: string, data: unknown, mode?: number) {
        const content = JSON.stringify(data, null, 2)
        yield* fs.writeFileString(target, content)
        if (mode) yield* fs.chmod(target, mode)
      })

      const ensureDir = Effect.fn("FileSystem.ensureDir")(function* (target: string) {
        yield* fs.makeDirectory(target, { recursive: true })
      })

      const writeWithDirs = Effect.fn("FileSystem.writeWithDirs")(function* (
        target: string,
        content: string | Uint8Array,
        mode?: number,
      ) {
        const write = typeof content === "string" ? fs.writeFileString(target, content) : fs.writeFile(target, content)

        yield* write.pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () =>
              Effect.gen(function* () {
                yield* fs.makeDirectory(path.dirname(target), { recursive: true })
                yield* write
              }),
          ),
        )
        if (mode) yield* fs.chmod(target, mode)
      })

      const glob = Effect.fn("FileSystem.glob")(function* (pattern: string, options?: Glob.Options) {
        return yield* Effect.tryPromise({
          try: () => Glob.scan(pattern, options),
          catch: (cause) => new FileSystemError({ method: "glob", cause }),
        })
      })

      const findUp = Effect.fn("FileSystem.findUp")(function* (target: string, start: string, stop?: string) {
        const result: string[] = []
        let current = start
        while (true) {
          const search = path.join(current, target)
          if (yield* fs.exists(search)) result.push(search)
          if (stop === current) break
          const parent = path.dirname(current)
          if (parent === current) break
          current = parent
        }
        return result
      })

      const up = Effect.fn("FileSystem.up")(function* (options: { targets: string[]; start: string; stop?: string }) {
        const result: string[] = []
        let current = options.start
        while (true) {
          for (const target of options.targets) {
            const search = path.join(current, target)
            if (yield* fs.exists(search)) result.push(search)
          }
          if (options.stop === current) break
          const parent = path.dirname(current)
          if (parent === current) break
          current = parent
        }
        return result
      })

      const globUp = Effect.fn("FileSystem.globUp")(function* (pattern: string, start: string, stop?: string) {
        const result: string[] = []
        let current = start
        while (true) {
          const matches = yield* glob(pattern, { cwd: current, absolute: true, include: "file", dot: true }).pipe(
            Effect.catch(() => Effect.succeed([] as string[])),
          )
          result.push(...matches)
          if (stop === current) break
          const parent = path.dirname(current)
          if (parent === current) break
          current = parent
        }
        return result
      })

      return Service.of({
        ...fs,
        existsSafe,
        isDir,
        isFile,
        readDirectoryEntries,
        readJson,
        writeJson,
        ensureDir,
        writeWithDirs,
        findUp,
        up,
        globUp,
        glob,
        globMatch: Glob.match,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(NodeFileSystem.layer))

  export function mimeType(target: string): string {
    return lookup(target) || "application/octet-stream"
  }

  export function normalizePath(target: string): string {
    if (process.platform !== "win32") return target
    const resolved = path.resolve(windowsPath(target))
    try {
      return realpathSync.native(resolved)
    } catch {
      return resolved
    }
  }

  export function normalizePathPattern(target: string): string {
    if (process.platform !== "win32") return target
    if (target === "*") return target
    const match = target.match(/^(.*)[\\/]\*$/)
    if (!match) return normalizePath(target)
    const dir = /^[A-Za-z]:$/.test(match[1]) ? match[1] + "\\" : match[1]
    return path.join(normalizePath(dir), "*")
  }

  export function resolve(target: string): string {
    const resolved = path.resolve(windowsPath(target))
    try {
      return normalizePath(realpathSync(resolved))
    } catch (error: any) {
      if (error?.code === "ENOENT") return normalizePath(resolved)
      throw error
    }
  }

  export function windowsPath(target: string): string {
    if (process.platform !== "win32") return target
    return target
      .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
  }

  export function overlaps(a: string, b: string) {
    const relA = path.relative(a, b)
    const relB = path.relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !path.relative(parent, child).startsWith("..")
  }
}
