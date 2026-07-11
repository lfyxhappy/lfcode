import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import path from "path"
import os from "os"
import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { Log } from "../util"
import { init } from "#db"

const log = Log.create({ service: "legacy-db" })
const LEGACY_DB_FILENAMES = ["lfcode.db", "mimocode.db", "opencode.db"] as const
const LEGACY_XDG_DATA_DIR = path.join(os.homedir(), ".local", "share", "lfcode")
const LEGACY_DB_MARKER_SUFFIX = ".legacy-merge-v1.json"

type RawStatement = {
  all: (...params: unknown[]) => unknown[]
}

type RawClient = {
  query?: (sqlText: string) => RawStatement
  prepare?: (sqlText: string) => RawStatement
}

type BunDb = SQLiteBunDatabase & {
  $client: RawClient
}

type DbCounts = {
  project: number
  session: number
  message: number
  part: number
  todo: number
  permission: number
}

type MarkerSignature = {
  filename: string
  mtimeMs: number
  size: number
}

type MergeMarker = {
  version: 1
  sources: MarkerSignature[]
}

type MergeCheck = {
  message: boolean
  part: boolean
  permission: boolean
  project: boolean
  session: boolean
  todo: boolean
}

function rawStatement(client: RawClient, sqlText: string) {
  if (typeof client.query === "function") return client.query(sqlText)
  if (typeof client.prepare === "function") return client.prepare(sqlText)
  throw new Error("SQLite client does not support query() or prepare()")
}

function rawAll<T>(db: SQLiteBunDatabase, sqlText: string) {
  return rawStatement((db as BunDb).$client, sqlText).all() as T[]
}

function inspectColumns(dbPath: string, table: string) {
  if (!existsSync(dbPath)) return new Set<string>()
  const db = init(dbPath)
  try {
    return new Set(rawAll<{ name: string }>(db, `select name from pragma_table_info('${table}')`).map((row) => row.name))
  } finally {
    ;(db.$client as { close?: () => void }).close?.()
  }
}

function inspectCounts(dbPath: string): DbCounts {
  if (!existsSync(dbPath)) return { message: 0, part: 0, permission: 0, project: 0, session: 0, todo: 0 }
  const db = init(dbPath)
  try {
    const count = (table: string) =>
      Number((rawAll<{ count?: number }>(db, `select count(*) as count from ${table}`)[0] ?? {}).count ?? 0)
    return {
      project: count("project"),
      session: count("session"),
      message: count("message"),
      part: count("part"),
      todo: count("todo"),
      permission: count("permission"),
    }
  } catch {
    return { message: 0, part: 0, permission: 0, project: 0, session: 0, todo: 0 }
  } finally {
    ;(db.$client as { close?: () => void }).close?.()
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function sourceColumn(alias: string, table: string, columns: Set<string>, column: string, fallback: string) {
  if (columns.has(column)) return `${alias}.${table}.${column}`
  return fallback
}

function runWithChanges(db: SQLiteBunDatabase, sqlText: string) {
  db.run(sqlText)
  return Number((rawAll<{ count?: number }>(db, "select changes() as count")[0] ?? {}).count ?? 0)
}

function sourceSignature(source: string): MarkerSignature {
  const stats = statSync(source)
  return {
    filename: path.basename(source),
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  }
}

function readMarker(markerPath: string) {
  if (!existsSync(markerPath)) return
  try {
    return JSON.parse(readFileSync(markerPath, "utf-8")) as MergeMarker
  } catch {
    return
  }
}

function sameMarker(marker: MergeMarker | undefined, sources: MarkerSignature[]) {
  if (!marker) return false
  return JSON.stringify(marker.sources) === JSON.stringify(sources)
}

function writeMarker(markerPath: string, sources: MarkerSignature[]) {
  writeFileSync(markerPath, JSON.stringify({ version: 1, sources } satisfies MergeMarker))
}

function hasMissingRows(db: SQLiteBunDatabase, sourcePath: string, alias: string) {
  const permissionColumns = inspectColumns(sourcePath, "permission")
  const checks: MergeCheck = {
    project: false,
    session: false,
    message: false,
    part: false,
    todo: false,
    permission: false,
  }

  db.run(`attach database ${sqlString(sourcePath)} as ${alias}`)
  try {
    checks.project =
      rawAll<{ missing?: number }>(
        db,
        `
        select exists(
          select 1
          from ${alias}.project
          left join main.project on main.project.id = ${alias}.project.id
          where main.project.id is null
          limit 1
        ) as missing
        `,
      )[0]?.missing === 1

    checks.session =
      rawAll<{ missing?: number }>(
        db,
        `
        select exists(
          select 1
          from ${alias}.session
          left join main.session on main.session.id = ${alias}.session.id
          where main.session.id is null
          limit 1
        ) as missing
        `,
      )[0]?.missing === 1

    checks.message =
      rawAll<{ missing?: number }>(
        db,
        `
        select exists(
          select 1
          from ${alias}.message
          left join main.message on main.message.id = ${alias}.message.id
          where main.message.id is null
          limit 1
        ) as missing
        `,
      )[0]?.missing === 1

    checks.part =
      rawAll<{ missing?: number }>(
        db,
        `
        select exists(
          select 1
          from ${alias}.part
          left join main.part on main.part.id = ${alias}.part.id
          where main.part.id is null
          limit 1
        ) as missing
        `,
      )[0]?.missing === 1

    checks.todo =
      rawAll<{ missing?: number }>(
        db,
        `
        select exists(
          select 1
          from ${alias}.todo
          left join main.todo
            on main.todo.session_id = ${alias}.todo.session_id
           and main.todo.position = ${alias}.todo.position
          where main.todo.session_id is null
          limit 1
        ) as missing
        `,
      )[0]?.missing === 1

    if (permissionColumns.has("data")) {
      checks.permission =
        rawAll<{ missing?: number }>(
          db,
          `
          select exists(
            select 1
            from ${alias}.permission
            left join main.permission on main.permission.project_id = ${alias}.permission.project_id
            where main.permission.project_id is null
            limit 1
          ) as missing
          `,
        )[0]?.missing === 1
    }
  } finally {
    db.run(`detach database ${alias}`)
  }

  return checks
}

function hasMissingLegacyRows(db: SQLiteBunDatabase, sources: string[]) {
  return sources
    .map((source, index) => ({ source, checks: hasMissingRows(db, source, `legacy_check_${index}`) }))
    .find((item) => Object.values(item.checks).some(Boolean))
}

function mergeSource(db: SQLiteBunDatabase, sourcePath: string, alias: string) {
  const projectColumns = inspectColumns(sourcePath, "project")
  const sessionColumns = inspectColumns(sourcePath, "session")
  const messageColumns = inspectColumns(sourcePath, "message")
  const todoColumns = inspectColumns(sourcePath, "todo")
  const permissionColumns = inspectColumns(sourcePath, "permission")
  const inserted = { message: 0, part: 0, permission: 0, project: 0, session: 0, todo: 0 }

  db.run(`attach database ${sqlString(sourcePath)} as ${alias}`)
  try {
    inserted.project = runWithChanges(
      db,
      `
      insert or ignore into project (
        id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands
      )
      select
        ${alias}.project.id,
        ${alias}.project.worktree,
        ${alias}.project.vcs,
        ${alias}.project.name,
        ${alias}.project.icon_url,
        ${alias}.project.icon_color,
        ${alias}.project.time_created,
        ${alias}.project.time_updated,
        ${alias}.project.time_initialized,
        ${alias}.project.sandboxes,
        ${sourceColumn(alias, "project", projectColumns, "commands", "null")}
      from ${alias}.project
      `,
    )

    inserted.session = runWithChanges(
      db,
      `
      insert or ignore into session (
        id,
        project_id,
        workspace_id,
        parent_id,
        context_from,
        context_watermark,
        slug,
        directory,
        title,
        version,
        share_url,
        summary_additions,
        summary_deletions,
        summary_files,
        summary_diffs,
        revert,
        permission,
        interaction,
        time_created,
        time_updated,
        time_compacting,
        time_archived,
        last_checkpoint_message_id
      )
      select
        ${alias}.session.id,
        ${alias}.session.project_id,
        ${sourceColumn(alias, "session", sessionColumns, "workspace_id", "null")},
        ${alias}.session.parent_id,
        ${sourceColumn(alias, "session", sessionColumns, "context_from", "null")},
        ${sourceColumn(alias, "session", sessionColumns, "context_watermark", "null")},
        ${alias}.session.slug,
        ${alias}.session.directory,
        ${alias}.session.title,
        ${alias}.session.version,
        ${alias}.session.share_url,
        ${alias}.session.summary_additions,
        ${alias}.session.summary_deletions,
        ${alias}.session.summary_files,
        ${alias}.session.summary_diffs,
        ${alias}.session.revert,
        ${alias}.session.permission,
        ${sourceColumn(alias, "session", sessionColumns, "interaction", "null")},
        ${alias}.session.time_created,
        ${alias}.session.time_updated,
        ${alias}.session.time_compacting,
        ${alias}.session.time_archived,
        ${sourceColumn(alias, "session", sessionColumns, "last_checkpoint_message_id", "null")}
      from ${alias}.session
      `,
    )

    inserted.message = runWithChanges(
      db,
      `
      insert or ignore into message (id, session_id, agent_id, time_created, time_updated, data)
      select
        ${alias}.message.id,
        ${alias}.message.session_id,
        ${sourceColumn(alias, "message", messageColumns, "agent_id", "'main'")},
        ${alias}.message.time_created,
        ${alias}.message.time_updated,
        ${alias}.message.data
      from ${alias}.message
      `,
    )

    inserted.part = runWithChanges(
      db,
      `
      insert or ignore into part (id, message_id, session_id, time_created, time_updated, data)
      select
        ${alias}.part.id,
        ${alias}.part.message_id,
        ${alias}.part.session_id,
        ${alias}.part.time_created,
        ${alias}.part.time_updated,
        ${alias}.part.data
      from ${alias}.part
      `,
    )

    inserted.todo = runWithChanges(
      db,
      `
      insert or ignore into todo (session_id, content, status, position, time_created, time_updated)
      select
        ${alias}.todo.session_id,
        ${alias}.todo.content,
        ${alias}.todo.status,
        ${alias}.todo.position,
        ${alias}.todo.time_created,
        ${alias}.todo.time_updated
      from ${alias}.todo
      `,
    )

    if (permissionColumns.has("data")) {
      inserted.permission = runWithChanges(
        db,
        `
        insert or ignore into permission (project_id, time_created, time_updated, data)
        select
          ${alias}.permission.project_id,
          ${alias}.permission.time_created,
          ${alias}.permission.time_updated,
          ${alias}.permission.data
        from ${alias}.permission
        `,
      )
    }
  } finally {
    db.run(`detach database ${alias}`)
  }

  return inserted
}

export function mergeLegacyDatabases(
  db: SQLiteBunDatabase,
  targetPath: string,
  options?: {
    cleanup?: boolean
    legacyDataDir?: string
  },
) {
  if (path.basename(targetPath) !== "lfcode.db") return

  const sources = legacyDatabaseSources(path.dirname(targetPath), options?.legacyDataDir)
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => candidate !== path.resolve(targetPath))
    .filter((candidate) => existsSync(candidate))
  if (sources.length === 0) return

  const markerPath = `${targetPath}${LEGACY_DB_MARKER_SUFFIX}`
  const signatures = sources.map(sourceSignature)
  const marker = readMarker(markerPath)
  if (sameMarker(marker, signatures)) {
    log.info("legacy db merge skipped", { reason: "marker matches", targetPath })
    cleanupDeprecatedDatabases(sources, options?.cleanup)
    return
  }

  for (const [index, source] of sources.entries()) {
    const counts = inspectCounts(source)
    const inserted = mergeSource(db, source, `legacy_merge_${index}`)
    log.warn("merged legacy database into lfcode", {
      counts,
      inserted,
      source,
      targetPath,
    })
  }

  cleanupDeprecatedDatabases(sources, options?.cleanup)
  writeMarker(markerPath, sources.filter(existsSync).map(sourceSignature))
}

function cleanupDeprecatedDatabases(sources: string[], cleanup = true) {
  if (!cleanup) return
  for (const source of sources) {
    const filename = path.basename(source)
    if (filename !== "opencode.db" && filename !== "mimocode.db") continue
    try {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(source + suffix, { force: true })
      log.info("removed deprecated database after verified migration", { source })
    } catch (err) {
      // SQLite can retain a Windows file handle briefly after DETACH; retry on the next startup.
      log.warn("deferred deprecated database cleanup", { err, source })
    }
  }
}

export function legacyDatabaseSources(dataDir: string, legacyDataDir = LEGACY_XDG_DATA_DIR) {
  return [...new Set([dataDir, legacyDataDir])].flatMap((dir) =>
    LEGACY_DB_FILENAMES.map((name) => path.join(dir, name)),
  )
}
