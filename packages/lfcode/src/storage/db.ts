import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "../util"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util"
import { NamedError } from "@lfcode-ai/shared/util/error"
import z from "zod"
import path from "path"
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "fs"
import { Flag } from "../flag/flag"
import { InstallationChannel } from "../installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { init } from "#db"
import { mergeLegacyDatabases } from "./legacy-db"

declare const LFCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })
const LEGACY_DB_FILENAMES = ["mimocode.db", "opencode.db"] as const

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.LFCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "lfcode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `lfcode-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.LFCODE_DB) {
    if (Flag.LFCODE_DB === ":memory:" || path.isAbsolute(Flag.LFCODE_DB)) return Flag.LFCODE_DB
    return path.join(Global.Path.data, Flag.LFCODE_DB)
  }
  const target = getChannelPath()
  adoptLegacyDatabaseIfNeeded(target)
  return target
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase
type RawStatement = {
  all: (...params: unknown[]) => unknown[]
}
type RawClient = {
  query?: (sqlText: string) => RawStatement
  prepare?: (sqlText: string) => RawStatement
}

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

function adoptLegacyDatabaseIfNeeded(target: string) {
  if (path.basename(target) === "lfcode.db") {
    const current = inspectUserData(target)
    if (current.projectCount > 0 || current.sessionCount > 0) return
    const source = LEGACY_DB_FILENAMES.map((name) => path.join(path.dirname(target), name))
      .filter((candidate) => candidate !== target)
      .map((candidate) => ({ path: candidate, ...inspectUserData(candidate) }))
      .filter((candidate) => candidate.projectCount > 0 || candidate.sessionCount > 0)
      .sort((a, b) => {
        if (b.latestSessionUpdated !== a.latestSessionUpdated) return b.latestSessionUpdated - a.latestSessionUpdated
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
        return b.projectCount - a.projectCount
      })[0]
    if (!source) return
    copySqliteFiles(source.path, target)
    log.warn("adopted legacy database for lfcode", {
      projectCount: source.projectCount,
      sessionCount: source.sessionCount,
      source: source.path,
      target,
    })
  }
}

function copySqliteFiles(source: string, target: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const sourceFile = source + suffix
    const targetFile = target + suffix
    if (existsSync(targetFile)) unlinkSync(targetFile)
    if (!existsSync(sourceFile)) continue
    copyFileSync(sourceFile, targetFile)
  }
}

function inspectUserData(dbPath: string) {
  if (!existsSync(dbPath)) return { latestSessionUpdated: 0, projectCount: 0, sessionCount: 0 }
  try {
    if (statSync(dbPath).size === 0) return { latestSessionUpdated: 0, projectCount: 0, sessionCount: 0 }
  } catch {
    return { latestSessionUpdated: 0, projectCount: 0, sessionCount: 0 }
  }
  const db = init(dbPath)
  try {
    const client = db.$client as RawClient & { close?: () => void }
    const projectCount = Number(
      (rawStatement(client, "select count(*) as count from project").all()[0] as { count?: number } | undefined)?.count ?? 0,
    )
    const sessionRow = rawStatement(
      client,
      "select count(*) as count, coalesce(max(time_updated), 0) as latest from session",
    ).all()[0] as { count?: number; latest?: number } | undefined
    return {
      latestSessionUpdated: Number(sessionRow?.latest ?? 0),
      projectCount,
      sessionCount: Number(sessionRow?.count ?? 0),
    }
  } catch {
    return { latestSessionUpdated: 0, projectCount: 0, sessionCount: 0 }
  } finally {
    ;(db.$client as { close?: () => void }).close?.()
  }
}

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries =
    typeof LFCODE_MIGRATIONS !== "undefined"
      ? LFCODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof LFCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    if (Flag.LFCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    migrate(db, entries)
  }

  mergeLegacyDatabases(db, Path)

  return db
})

export function close() {
  Client().$client.close()
  Client.reset()
}

function rawStatement(client: RawClient, sqlText: string) {
  if (typeof client.query === "function") return client.query(sqlText)
  if (typeof client.prepare === "function") return client.prepare(sqlText)
  throw new Error("SQLite client does not support query() or prepare()")
}

function statement(sqlText: string) {
  return rawStatement(Client().$client as RawClient, sqlText)
}

export function rawAll<T>(sqlText: string, ...params: unknown[]): T[] {
  return statement(sqlText).all(...params) as T[]
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}
