import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { LayerNode } from "./effect/layer-node"

const app = "lfcode"
const WINDOWS_HOME_ROOT = ".lfcode"
const resolvedPaths = resolveCorePaths()
const tmp = path.join(os.tmpdir(), app)

const paths = {
  get home() {
    return process.env.LFCODE_TEST_HOME ?? os.homedir()
  },
  data: resolvedPaths.data,
  bin: path.join(resolvedPaths.cache, "bin"),
  log: path.join(resolvedPaths.data, "log"),
  repos: path.join(resolvedPaths.data, "repos"),
  cache: resolvedPaths.cache,
  config: resolvedPaths.config,
  state: resolvedPaths.state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state: Path.state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@lfcode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.LFCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: path.join(Path.cache, "bin"),
    log: path.join(Path.data, "log"),
    repos: path.join(Path.data, "repos"),
    ...input,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"

function resolveCorePaths(env: NodeJS.ProcessEnv = process.env) {
  const home = env.USERPROFILE ?? os.homedir()
  const defaults =
    process.platform === "win32"
      ? {
          cache: path.join(home, WINDOWS_HOME_ROOT, "cache"),
          config: path.join(home, WINDOWS_HOME_ROOT, "config"),
          data: path.join(home, WINDOWS_HOME_ROOT, "data"),
          state: path.join(home, WINDOWS_HOME_ROOT, "state"),
        }
      : {
          cache: path.join(xdgCache!, app),
          config: path.join(xdgConfig!, app),
          data: path.join(xdgData!, app),
          state: path.join(xdgState!, app),
        }

  return {
    data: env.LFCODE_DATA_DIR || defaults.data,
    cache: env.LFCODE_CACHE_DIR || defaults.cache,
    config: env.LFCODE_CONFIG_DIR || defaults.config,
    state: env.LFCODE_STATE_DIR || defaults.state,
  }
}
