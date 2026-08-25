export * as ConfigPaths from "./paths"

import path from "path"
import { Filesystem } from "@/util"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { unique } from "remeda"
import { JsonError } from "./error"
import * as Effect from "effect/Effect"
import { AppFileSystem } from "@/filesystem"
import { Glob } from "@lfcode-ai/shared/util/glob"
import { PluginPath } from "@/plugin/path"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* AppFileSystem.Service
  return unique([
    Global.Path.config,
    ...(!Flag.LFCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".lfcode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".lfcode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.LFCODE_CONFIG_DIR ? [Flag.LFCODE_CONFIG_DIR] : []),
  ])
})

// Root-layout profiles keep local plugins beside instance data. Discover that
// directory even though it is not necessarily a config-file directory.
export const pluginDirectories = Effect.fn("ConfigPaths.pluginDirectories")(function* (directory: string, worktree?: string) {
  const roots = yield* directories(directory, worktree)
  const root = PluginPath.profileRoot()
  const pluginRoot = PluginPath.root()
  yield* Effect.promise(() => PluginPath.migrateLegacyPlugins())
  const hasPlugins = yield* Effect.promise(() =>
    Glob.scan("*/package.json", { cwd: pluginRoot, absolute: false, dot: true }).then((items) => items.length > 0).catch(() => false),
  )
  return hasPlugins ? unique([...roots, root]) : roots
})

export const claudeCommandDirectories = Effect.fn("ConfigPaths.claudeCommandDirectories")(function* (
  directory: string,
  worktree?: string,
) {
  if (Flag.LFCODE_DISABLE_CLAUDE_CODE_COMMANDS) return []
  const afs = yield* AppFileSystem.Service
  return unique([
    path.join(Global.Path.home, ".claude"),
    ...(!Flag.LFCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".claude"],
          start: directory,
          stop: worktree,
        })
      : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

/** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
export async function readFile(filepath: string) {
  return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return
    throw new JsonError({ path: filepath }, { cause: err })
  })
}

