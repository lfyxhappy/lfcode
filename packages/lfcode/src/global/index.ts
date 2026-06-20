import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "../util"
import { Flock } from "@lfcode-ai/shared/util/flock"
import { resolveLfcodeHome } from "../../../shared/src/global"

const LEGACY_DB_BASENAMES = ["lfcode.db", "mimocode.db", "opencode.db"] as const
const paths = resolveLfcodeHome()

export const Path = {
  // HOME/USERPROFILE read directly because Bun caches os.homedir() at startup.
  // Tests set these env vars to isolate from the developer's real home.
  get home() {
    return process.env.HOME || process.env.USERPROFILE || os.homedir()
  },
  data: paths.data,
  bin: path.join(paths.cache, "bin"),
  log: path.join(paths.data, "log"),
  cache: paths.cache,
  config: paths.config,
  state: paths.state,
}

// Initialize Flock with global state path
Flock.setGlobal({ state: Path.state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
])

await migrateLegacyWindowsHome()

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch {}
  await Filesystem.write(path.join(Path.cache, "version"), CACHE_VERSION)
}

export * as Global from "."

async function migrateLegacyWindowsHome() {
  if (process.platform !== "win32") return
  if (!isDefaultWindowsRoot()) return

  const marker = path.join(Path.state, "migration", "legacy-windows-home-v2.json")
  if (await Filesystem.exists(marker)) return

  await fs.mkdir(path.dirname(marker), { recursive: true })
  const copied: string[] = []
  const preserved: string[] = []

  const legacyRoots = [
    {
      source: path.join(Path.home, ".config", "lfcode"),
      target: Path.config,
      skip: undefined,
    },
    {
      source: path.join(Path.home, ".local", "share", "lfcode"),
      target: Path.data,
      skip: shouldSkipLegacyDataFile,
    },
    {
      source: path.join(Path.home, ".local", "state", "lfcode"),
      target: Path.state,
      skip: undefined,
    },
    {
      source: path.join(Path.home, ".cache", "lfcode"),
      target: Path.cache,
      skip: undefined,
    },
  ]

  for (const root of legacyRoots) {
    await copyMissingPath(root.source, root.target, copied, preserved, root.skip)
  }

  await Filesystem.write(
    marker,
    JSON.stringify(
      {
        version: 1,
        roots: legacyRoots.map((root) => root.source),
        copied,
        preserved,
      },
      null,
      2,
    ),
  )
}

function isDefaultWindowsRoot() {
  const defaultRoot = path.join(Path.home, ".lfcode")
  return path.resolve(paths.root ?? "") === path.resolve(defaultRoot)
}

async function copyMissingPath(
  source: string,
  target: string,
  copied: string[],
  preserved: string[],
  skipFile?: (source: string) => boolean,
) {
  const sourceInfo = await fs.stat(source).catch(() => undefined)
  if (!sourceInfo) return

  const targetInfo = await fs.stat(target).catch(() => undefined)
  if (sourceInfo.isDirectory()) {
    if (targetInfo && !targetInfo.isDirectory()) {
      preserved.push(target)
      return
    }

    await fs.mkdir(target, { recursive: true })
    const entries = await fs.readdir(source)
    for (const entry of entries) {
      await copyMissingPath(path.join(source, entry), path.join(target, entry), copied, preserved, skipFile)
    }
    return
  }

  if (skipFile?.(source)) return
  if (targetInfo) {
    preserved.push(target)
    return
  }

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  copied.push(target)
}

function shouldSkipLegacyDataFile(source: string) {
  const name = path.basename(source)
  return LEGACY_DB_BASENAMES.some(
    (base) => name === base || name.startsWith(`${base}-`) || name.startsWith(`${base}.legacy-merge-`),
  )
}
