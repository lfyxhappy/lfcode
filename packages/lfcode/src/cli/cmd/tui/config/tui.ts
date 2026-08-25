export * as TuiConfig from "./tui"

import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Exit, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@/global"
import { AppFileSystem } from "@/filesystem"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { makeRuntime } from "@/effect/runtime"
import { Filesystem, Log } from "@/util"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@/npm"
import { listManagedPluginSpecs, registryFile } from "@/plugin/library"

const log = Log.create({ service: "tui.config" })

export const Info = TuiInfo

type Acc = {
  result: Info
}

type State = {
  config: Info
  deps: Array<Fiber.Fiber<void, AppFileSystem.Error>>
}

export type Info = z.output<typeof Info> & {
  // Internal resolved plugin list used by runtime loading.
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function mergePluginOrigins(acc: Acc, source: string, list: ConfigPlugin.Spec[], scope: ConfigPlugin.Scope) {
  if (!list.length) return
  const plugins = ConfigPlugin.deduplicatePluginOrigins([
    ...(acc.result.plugin_origins ?? []),
    ...list.map((spec) => ({ spec, scope, source })),
  ])
  acc.result.plugin = plugins.map((item) => item.spec)
  acc.result.plugin_origins = plugins
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return ConfigPlugin.normalizePluginConfigAliases(data)
  if (!isRecord(data.tui)) {
    delete data.tui
    return ConfigPlugin.normalizePluginConfigAliases(data)
  }

  const tui = data.tui
  delete data.tui
  return ConfigPlugin.normalizePluginConfigAliases({
    ...tui,
    ...data,
  })
}

async function resolvePlugins(config: Info, configFilepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], configFilepath)
  }
  return config
}

function localPluginDir() {
  try {
    const resolved = import.meta.resolve("@lfcode-ai/plugin/package.json")
    return path.dirname(resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved)
  } catch {
    return
  }
}

async function mergeFile(acc: Acc, file: string, ctx: { directory: string }) {
  const data = await loadFile(file)
  acc.result = mergeDeep(acc.result, data)
  if (!data.plugin?.length) return
  mergePluginOrigins(acc, file, data.plugin, pluginScope(file, ctx))
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  // Every config dir we may read from: global config dir, any `.lfcode`
  // folders between cwd and home, and LFCODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.LFCODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 2. Explicit LFCODE_TUI_CONFIG override, if set.
  if (Flag.LFCODE_TUI_CONFIG) {
    const configFile = Flag.LFCODE_TUI_CONFIG
    yield* Effect.promise(() => mergeFile(acc, configFile, ctx)).pipe(Effect.orDie)
    log.debug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 4. `.lfcode` directories (and LFCODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const dirs = unique(directories).filter((dir) => dir.endsWith(".lfcode") || dir === Flag.LFCODE_CONFIG_DIR)

  for (const dir of dirs) {
    if (!dir.endsWith(".lfcode") && dir !== Flag.LFCODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
    }
  }

  mergePluginOrigins(
    acc,
    registryFile(),
    yield* Effect.promise(() => listManagedPluginSpecs()),
    "global",
  )

  const keybinds = { ...(acc.result.keybinds ?? {}) }
  if (process.platform === "win32") {
    // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
    keybinds.terminal_suspend = "none"
    keybinds.input_undo ??= unique([
      "ctrl+z",
      ...ConfigKeybinds.Keybinds.shape.input_undo.parse(undefined).split(","),
    ]).join(",")
  }
  acc.result.keybinds = ConfigKeybinds.Keybinds.parse(keybinds)

  return {
    config: acc.result,
    dirs: acc.result.plugin?.length ? dirs : [],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps: Fiber.Fiber<void, never>[] = []
    yield* Effect.forEach(
      data.dirs,
      (dir) =>
        Effect.gen(function* () {
          const plugins = yield* Effect.promise(() => ConfigPlugin.load(dir))
          if (!plugins.length) return
          const pluginDir = localPluginDir()
          if (!pluginDir) {
            log.warn("skipped local plugin dependency bootstrap; bundled @lfcode-ai/plugin runtime is unavailable", {
              dir,
            })
            return
          }
          const dep = yield* npm
            .install(dir, {
              add: [
                {
                  name: pluginDir,
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.sync(() => {
                      log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                    })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)
        }),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}

async function loadFile(filepath: string): Promise<Info> {
  const text = await ConfigPaths.readFile(filepath)
  if (!text) return {}
  return load(text, filepath).catch((error) => {
    log.warn("failed to load tui config", { path: filepath, error })
    return {}
  })
}

async function load(text: string, configFilepath: string): Promise<Info> {
  return ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" })
    .then((expanded) => ConfigParse.jsonc(expanded, configFilepath))
    .then((data) => {
      if (!isRecord(data)) return {}

      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old lfcode.json shape) still get their settings applied.
      return ConfigParse.schema(Info, normalize(data), configFilepath)
    })
    .then((data) => resolvePlugins(data, configFilepath))
    .catch((error) => {
      log.warn("invalid tui config", { path: configFilepath, error })
      return {}
    })
}

