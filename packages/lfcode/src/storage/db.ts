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
import { existsSync, readFileSync, readdirSync, rmSync } from "fs"
import { Flag } from "../flag/flag"
import { InstallationChannel } from "../installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { init } from "#db"
import { compactFileDiffForSummary } from "@/session/file-diff"
import type { SQLQueryBindings } from "bun:sqlite"

declare const LFCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })
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
  return target
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = ReturnType<typeof init>
type RawClient = Client["$client"]
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

  if (!Flag.LFCODE_SKIP_MIGRATIONS) {
    const removedWorkflowArtifacts = cleanupRetiredWorkflowArtifacts()
    if (removedWorkflowArtifacts.length > 0)
      log.info("cleaned retired workflow artifacts", { count: removedWorkflowArtifacts.length })
  }

  repairRecentUserActivitySchema(db)
  repairOversizedMessageSummaryDiffs(db)

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

function hasColumn(client: RawClient, table: string, column: string) {
  return rawStatement(client, `PRAGMA table_info("${table}")`)
    .all()
    .some((row: unknown) => typeof row === "object" && row !== null && "name" in row && row.name === column)
}

function repairRecentUserActivitySchema(db: Client) {
  const client = db.$client
  const sessionHas = hasColumn(client, "session", "time_last_user")
  const projectHas = hasColumn(client, "project", "time_last_user")
  if (sessionHas && projectHas) return

  if (!sessionHas) db.run("ALTER TABLE `session` ADD COLUMN `time_last_user` integer")
  if (!projectHas) db.run("ALTER TABLE `project` ADD COLUMN `time_last_user` integer")

  db.run(`
    UPDATE session
    SET time_last_user = (
      SELECT max(message.time_created)
      FROM message
      WHERE message.session_id = session.id
        AND json_extract(message.data, '$.role') = 'user'
        AND EXISTS (
          SELECT 1
          FROM part
          WHERE part.message_id = message.id
            AND (
              json_extract(part.data, '$.type') <> 'text'
              OR (
                coalesce(json_extract(part.data, '$.synthetic'), 0) = 0
                AND coalesce(json_extract(part.data, '$.ignored'), 0) = 0
                AND length(trim(coalesce(json_extract(part.data, '$.text'), ''))) > 0
              )
            )
        )
    )
  `)

  db.run(`
    UPDATE project
    SET time_last_user = (
      SELECT max(session.time_last_user)
      FROM session
      WHERE session.project_id = project.id
    )
  `)

  log.warn("repaired recent user activity schema", { projectHas, sessionHas })
}

export function cleanupRetiredWorkflowArtifacts(dir = path.join(Global.Path.data, "workflow")) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !/^wf_[0-9A-Za-z]+\.(js|jsonl)$/.test(entry.name)) return []
    rmSync(path.join(dir, entry.name), { force: true })
    return [entry.name]
  })
}

function repairOversizedMessageSummaryDiffs(db: Client) {
  const rows = rawStatement(db.$client, `
    select id, data
    from message
    where json_extract(data, '$.role') = 'user'
      and json_extract(data, '$.summary.diffs') is not null
      and instr(data, '"patch"') > 0
  `).all() as { id: string; data: string }[]
  if (rows.length === 0) return

  let repaired = 0
  for (const row of rows) {
    const next = sanitizeMessageSummaryDiffs(row.data)
    if (!next) continue
    rawStatement(db.$client, "update message set data = ? where id = ?").run(next, row.id)
    repaired++
  }

  if (repaired > 0) {
    log.warn("repaired oversized message summary diffs", { repaired })
  }
}

function sanitizeMessageSummaryDiffs(raw: string) {
  try {
    const parsed = JSON.parse(raw) as {
      role?: unknown
      summary?: { diffs?: unknown } | null
    }
    if (parsed.role !== "user") return
    if (!parsed.summary || typeof parsed.summary !== "object") return
    if (!Array.isArray(parsed.summary.diffs)) return

    const nextDiffs = parsed.summary.diffs
      .flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const diff = item as Record<string, unknown>
        const file =
          typeof diff.file === "string"
            ? diff.file
            : typeof diff.relativePath === "string"
              ? diff.relativePath
              : typeof diff.filePath === "string"
                ? diff.filePath
                : undefined
        if (!file) return []
        const patch = typeof diff.patch === "string" ? diff.patch : ""
        const additions = typeof diff.additions === "number" ? diff.additions : 0
        const deletions = typeof diff.deletions === "number" ? diff.deletions : 0
        const status =
          diff.status === "added" || diff.status === "deleted" || diff.status === "modified"
            ? diff.status
            : undefined
        return [
          compactFileDiffForSummary({
            file,
            patch,
            additions,
            deletions,
            ...(status ? { status } : {}),
          }),
        ]
      })

    const next = {
      ...parsed,
      summary: {
        ...parsed.summary,
        diffs: nextDiffs,
      },
    }
    const encoded = JSON.stringify(next)
    if (encoded === raw) return
    return encoded
  } catch {
    return
  }
}

function statement(sqlText: string) {
  return rawStatement(Client().$client, sqlText)
}

export function rawAll<T>(sqlText: string, ...params: SQLQueryBindings[]): T[] {
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
