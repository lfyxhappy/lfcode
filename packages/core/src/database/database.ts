export * as Database from "./database"

import { EffectDrizzleSqlite } from "@lfcode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { existsSync } from "node:fs"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { LayerNode } from "../effect/layer-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/v2/storage/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.LFCODE_DB) {
    if (Flag.LFCODE_DB === ":memory:" || isAbsolute(Flag.LFCODE_DB)) return Flag.LFCODE_DB
    return join(Global.Path.data, Flag.LFCODE_DB)
  }
  const stableName =
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.LFCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.LFCODE_DISABLE_CHANNEL_DB === "true"
  const current = join(
    Global.Path.data,
    stableName ? "lfcode.db" : `lfcode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`,
  )
  if (existsSync(current)) return current
  const legacy = join(
    Global.Path.data,
    stableName ? "lfcode.db" : `lfcode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`,
  )
  if (existsSync(legacy)) return legacy
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.LFCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.LFCODE_DISABLE_CHANNEL_DB === "true"
  )
    return current
  return current
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    return layerFromPath(path())
  }),
).pipe(Layer.provide(Global.defaultLayer))

export const node = LayerNode.make(layerFromPath(path()), [])
