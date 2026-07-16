export * as Npm from "."

import path from "path"
import { createHash, randomUUID } from "crypto"
import npa from "npm-package-arg"
import semver from "semver"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"
import { EffectFlock } from "@/util/effect-flock"

import { makeRuntime } from "../effect/runtime"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint: Option.Option<string>
}

export interface Interface {
  readonly add: (pkg: string) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly install: (
    dir: string,
    input?: {
      add: {
        name: string
        version?: string
      }[]
    },
  ) => Effect.Effect<void, EffectFlock.LockError | InstallFailedError>
  readonly outdated: (pkg: string, cachedVersion: string) => Effect.Effect<boolean>
  readonly which: (pkg: string) => Effect.Effect<Option.Option<string>>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Npm") {}

const CACHE_MARKER = ".lfcode-install.json"
const CACHE_MARKER_VERSION = 1

export function sanitize(pkg: string) {
  return cacheKey(pkg)
}

export function canonicalSpec(pkg: string) {
  const spec = pkg.trim()
  try {
    const hit = npa(spec)
    if ((hit.type === "directory" || hit.type === "file") && typeof hit.fetchSpec === "string") {
      return `file:${path.normalize(path.resolve(hit.fetchSpec))}`
    }
    return hit.toString()
  } catch {
    return spec
  }
}

export function cacheKey(pkg: string) {
  return createHash("sha256").update(canonicalSpec(pkg)).digest("hex")
}

export function resolveCacheDirectory(root: string, pkg: string) {
  const base = path.resolve(root)
  const target = path.resolve(base, cacheKey(pkg))
  const relative = path.relative(base, target)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`Invalid npm cache path for ${pkg}`)
  }
  return target
}

const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
  let entrypoint: Option.Option<string>
  try {
    const resolved = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
    entrypoint = Option.some(resolved)
  } catch {
    entrypoint = Option.none()
  }
  return {
    directory: dir,
    entrypoint,
  }
}

interface ArboristNode {
  name: string
  path: string
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
}

interface CacheMarker {
  version: number
  spec: string
  name: string
  packagePath: string
}

function isCacheMarker(input: unknown): input is CacheMarker {
  if (!input || typeof input !== "object") return false
  const value = input as Record<string, unknown>
  return (
    value.version === CACHE_MARKER_VERSION &&
    typeof value.spec === "string" &&
    typeof value.name === "string" &&
    typeof value.packagePath === "string"
  )
}

function containedPath(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
  return path.resolve(root, relative)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* AppFileSystem.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const cacheRoot = path.resolve(Global.Path.cache, "packages")
    const directory = (pkg: string) => resolveCacheDirectory(cacheRoot, pkg)
    const runReify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const arborist = new Arborist({
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              add: input?.add || [],
              save: true,
              saveType: "prod",
            }),
          catch: (cause) =>
            new InstallFailedError({
              cause,
              add: input?.add,
              dir: input.dir,
            }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )
    const reify = (input: { dir: string; add?: string[] }) =>
      flock.withLock(runReify(input), `npm-install:${path.resolve(input.dir)}`)

    const readCache = (dir: string, spec: string) =>
      Effect.gen(function* () {
        const marker = yield* afs.readJson(path.join(dir, CACHE_MARKER)).pipe(Effect.option)
        if (Option.isNone(marker) || !isCacheMarker(marker.value) || marker.value.spec !== spec) {
          return Option.none<EntryPoint>()
        }
        const packageDir = containedPath(dir, path.resolve(dir, marker.value.packagePath))
        if (!packageDir || !(yield* afs.isFile(path.join(packageDir, "package.json")))) {
          return Option.none<EntryPoint>()
        }
        return Option.some(resolveEntryPoint(marker.value.name, packageDir))
      })

    const outdated = Effect.fn("Npm.outdated")(function* (pkg: string, cachedVersion: string) {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`https://registry.npmjs.org/${pkg}`),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined))

      if (!response || !response.ok) {
        return false
      }

      const data = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ "dist-tags"?: { latest?: string } }>,
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined))

      const latestVersion = data?.["dist-tags"]?.latest
      if (!latestVersion) {
        return false
      }

      const range = /[\s^~*xX<>|=]/.test(cachedVersion)
      if (range) return !semver.satisfies(latestVersion, cachedVersion)

      return semver.lt(cachedVersion, latestVersion)
    })

    const add = Effect.fn("Npm.add")(function* (pkg: string) {
      const dir = directory(pkg)
      const spec = canonicalSpec(pkg)
      return yield* flock.withLock(
        Effect.gen(function* () {
          const cached = yield* readCache(dir, spec)
          if (Option.isSome(cached)) return cached.value

          const temp = path.join(cacheRoot, `.${path.basename(dir)}.tmp-${randomUUID()}`)
          const install = Effect.gen(function* () {
            yield* fs.makeDirectory(cacheRoot, { recursive: true }).pipe(
              Effect.mapError((cause) => new InstallFailedError({ cause, add: [pkg], dir })),
            )
            const tree = yield* runReify({ dir: temp, add: [pkg] })
            const first = tree.edgesOut.values().next().value?.to
            const packageDir = first && containedPath(temp, first.path)
            if (!first || !packageDir || !(yield* afs.isFile(path.join(packageDir, "package.json")))) {
              return yield* new InstallFailedError({ add: [pkg], dir })
            }
            yield* afs
              .writeJson(path.join(temp, CACHE_MARKER), {
                version: CACHE_MARKER_VERSION,
                spec,
                name: first.name,
                packagePath: path.relative(temp, packageDir),
              } satisfies CacheMarker)
              .pipe(Effect.mapError((cause) => new InstallFailedError({ cause, add: [pkg], dir })))
            yield* fs.remove(dir, { recursive: true, force: true }).pipe(
              Effect.mapError((cause) => new InstallFailedError({ cause, add: [pkg], dir })),
            )
            yield* fs
              .rename(temp, dir)
              .pipe(Effect.mapError((cause) => new InstallFailedError({ cause, add: [pkg], dir })))
            return resolveEntryPoint(first.name, path.join(dir, path.relative(temp, packageDir)))
          }).pipe(Effect.ensuring(fs.remove(temp, { recursive: true, force: true }).pipe(Effect.ignore)))

          return yield* install
        }),
        `npm-cache:${path.basename(dir)}`,
      )
    })

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map((pkg) => [pkg.name, pkg.version].filter(Boolean).join("@")) ?? []
      if (
        yield* Effect.gen(function* () {
          const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules"))
          if (!nodeModulesExists) {
            yield* reify({ add, dir })
            return true
          }
          return false
        }).pipe(Effect.withSpan("Npm.checkNodeModules"))
      )
        return

      yield* Effect.gen(function* () {
        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        const pkgAny = pkg as any
        const lockAny = lock as any
        const declared = new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
          ...(input?.add || []).map((pkg) => pkg.name),
        ])

        const root = lockAny?.packages?.[""] || {}
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {}),
        ])

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify({ dir, add })
            return
          }
        }
      }).pipe(Effect.withSpan("Npm.checkDirty"))

      return
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string) {
      const dir = directory(pkg)
      const binDir = path.join(dir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

        if (files.length === 0) return Option.none<string>()
        if (files.length === 1) return Option.some(files[0])

        const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", pkg, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
            const bin = parsed.bin
            if (typeof bin === "string") return Option.some(unscoped)
            const keys = Object.keys(bin)
            if (keys.length === 1) return Option.some(keys[0])
            return bin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
          }
        }

        return Option.some(files[0])
      })

      return yield* Effect.gen(function* () {
        yield* add(pkg)
        const bin = yield* pick()
        if (Option.isNone(bin)) return Option.none<string>()
        return Option.some(path.join(binDir, bin.value))
      }).pipe(
        Effect.orElseSucceed(() => Option.none<string>()),
      )
    })

    return Service.of({
      add,
      install,
      outdated,
      which,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.layer),
  Layer.provide(AppFileSystem.layer),
  Layer.provide(NodeFileSystem.layer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>) {
  const entry = await runPromise((svc) => svc.add(...args))
  return {
    directory: entry.directory,
    entrypoint: Option.getOrUndefined(entry.entrypoint),
  }
}

export async function outdated(...args: Parameters<Interface["outdated"]>) {
  return runPromise((svc) => svc.outdated(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  const resolved = await runPromise((svc) => svc.which(...args))
  return Option.getOrUndefined(resolved)
}


