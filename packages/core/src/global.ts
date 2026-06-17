import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { LayerNode } from "./effect/layer-node"

const app = "lfcode"
const data = process.env.LFCODE_DATA_DIR ?? path.join(xdgData!, app)
const cache = process.env.LFCODE_CACHE_DIR ?? path.join(xdgCache!, app)
const config = process.env.LFCODE_CONFIG_DIR ?? path.join(xdgConfig!, app)
const state = process.env.LFCODE_STATE_DIR ?? path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

const paths = {
  get home() {
    return process.env.LFCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

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
    data,
    cache,
    config: Flag.LFCODE_CONFIG_DIR ?? Path.config,
    state,
    tmp: Path.tmp,
    bin: path.join(cache, "bin"),
    log: path.join(data, "log"),
    repos: path.join(data, "repos"),
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
