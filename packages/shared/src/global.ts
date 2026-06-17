import path from "path"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"

const APP = "lfcode"

export type ResolvedPaths = {
  mode: "lfcode_home" | "xdg"
  root?: string
  data: string
  cache: string
  config: string
  state: string
}

/**
 * Resolve lfcode's four base directories (config/data/state/cache)
 * from environment variables.
 *
 * If LFCODE_HOME is set and non-empty, the four paths are subdirectories
 * of it. Legacy OPENCODE_* and MIMOCODE_HOME values remain as fallbacks.
 * Otherwise, falls through to XDG Base Directory defaults.
 *
 * @throws if LFCODE_HOME is set but not an absolute path
 */
export function resolveLfcodeHome(env: NodeJS.ProcessEnv = process.env): ResolvedPaths {
  const config = env.LFCODE_CONFIG_DIR ?? env.OPENCODE_CONFIG_DIR
  const data = env.LFCODE_DATA_DIR ?? env.OPENCODE_DATA_DIR
  const state = env.LFCODE_STATE_DIR ?? env.OPENCODE_STATE_DIR
  const cache = env.LFCODE_CACHE_DIR ?? env.OPENCODE_CACHE_DIR
  if (config || data || state || cache) {
    if (!config || !data || !state || !cache) {
      throw new Error("LFCODE_CONFIG_DIR, LFCODE_DATA_DIR, LFCODE_STATE_DIR, and LFCODE_CACHE_DIR must all be set together")
    }
    for (const [key, value] of Object.entries({
      LFCODE_CONFIG_DIR: config,
      LFCODE_DATA_DIR: data,
      LFCODE_STATE_DIR: state,
      LFCODE_CACHE_DIR: cache,
    })) {
      if (!path.isAbsolute(value)) {
        throw new Error(`${key} must be an absolute path, got: ${JSON.stringify(value)}`)
      }
    }
    return {
      mode: "xdg",
      config,
      data,
      state,
      cache,
    }
  }

  const home = env.LFCODE_HOME ?? env.MIMOCODE_HOME
  if (home) {
    if (!path.isAbsolute(home)) {
      throw new Error(`LFCODE_HOME must be an absolute path, got: ${JSON.stringify(home)}`)
    }
    return {
      mode: "lfcode_home",
      root: home,
      data: path.join(home, "data"),
      cache: path.join(home, "cache"),
      config: path.join(home, "config"),
      state: path.join(home, "state"),
    }
  }
  return {
    mode: "xdg",
    data: path.join(xdgData!, APP),
    cache: path.join(xdgCache!, APP),
    config: path.join(xdgConfig!, APP),
    state: path.join(xdgState!, APP),
  }
}

export namespace Global {
  export class Service extends Context.Service<Service, Interface>()("@lfcode/Global") {}

  export interface Interface {
    readonly home: string
    readonly data: string
    readonly cache: string
    readonly config: string
    readonly state: string
    readonly bin: string
    readonly log: string
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
      const { data, cache, config, state } = yield* Effect.sync(() => resolveLfcodeHome())
      const bin = path.join(cache, "bin")
      const log = path.join(data, "log")

      return Service.of({
        home,
        data,
        cache,
        config,
        state,
        bin,
        log,
      })
    }),
  )
}
