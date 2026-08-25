import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "../util"
import { Flock } from "@lfcode-ai/shared/util/flock"
import { resolveLfcodeHome } from "../../../shared/src/global"

const paths = resolveLfcodeHome()

export const Path = {
  // HOME/USERPROFILE read directly because Bun caches os.homedir() at startup.
  // Tests set these env vars to isolate from the developer's real home.
  get home() {
    return process.env.LFCODE_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir()
  },
  // Profile roots are intentionally separate from the OS account root. External
  // Skill imports must keep reading the account-level Codex/Claude/Agents folders.
  get osHome() {
    return process.env.LFCODE_OS_HOME || os.homedir()
  },
  data: paths.data,
  bin: path.join(paths.config, "plugins", "editor-tools", "data"),
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
