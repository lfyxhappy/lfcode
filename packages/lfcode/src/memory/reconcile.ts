import fs from "fs/promises"
import path from "path"
import { Database, eq } from "../storage"
import { Log } from "../util"
import { MemoryFtsTable } from "./fts.sql"
import { MemoryRecordTable } from "./record.sql"
import { parsePath, parseCcPath, parseCcFrontmatterType, type MemoryLocator } from "./paths"

const log = Log.create({ service: "memory.reconcile" })

export async function walkMemoryDir(root: string): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [] as import("fs").Dirent[]
      throw e
    })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await recurse(full)
      else if (entry.isFile() && full.endsWith(".md")) out.push(full)
    }
  }
  await recurse(root)
  return out
}

// Walk <base>/<slug>/memory/**/*.md across every slug under <base>.
// ENOENT on <base> returns []; missing memory subdirs are silently skipped.
export async function walkCcRoot(base: string): Promise<string[]> {
  const slugs = await fs.readdir(base, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [] as import("fs").Dirent[]
    throw e
  })
  const out: string[] = []
  for (const entry of slugs) {
    if (!entry.isDirectory()) continue
    const memoryDir = path.join(base, entry.name, "memory")
    const exists = await fs.stat(memoryDir).then(() => true).catch(() => false)
    if (!exists) continue
    const files = await walkMemoryDir(memoryDir)
    for (const f of files) out.push(f)
  }
  return out
}

export async function indexFromDisk(
  absPath: string,
  loc: MemoryLocator,
  bodyType: "lfcode" | "cc",
  oldFingerprint?: string,
): Promise<"hit" | "updated" | "skipped"> {
  const stat = await fs.stat(absPath).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null
    throw e
  })
  if (!stat) return "skipped"
  const fingerprint = `${stat.size}-${stat.mtimeMs}`
  if (oldFingerprint === fingerprint) return "hit"

  const body = await fs.readFile(absPath, "utf-8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return undefined
    throw e
  })
  if (body === undefined) return "skipped"

  // For external files, derive type from frontmatter; Lfcode files keep loc.type from path.
  const finalType =
    bodyType === "cc" ? (parseCcFrontmatterType(body) ?? "free") : loc.type

  Database.use((db) =>
    db
      .insert(MemoryFtsTable)
      .values({
        path: absPath,
        scope: loc.scope,
        scope_id: loc.scope_id,
        type: finalType,
        body,
        fingerprint,
        last_indexed_at: Date.now(),
      })
      .onConflictDoUpdate({
        target: MemoryFtsTable.path,
        set: {
          scope: loc.scope,
          scope_id: loc.scope_id,
          type: finalType,
          body,
          fingerprint,
          last_indexed_at: Date.now(),
        },
      })
      .run(),
  )
  const now = Date.now()
  const existing = Database.use((db) =>
    db.select().from(MemoryRecordTable).where(eq(MemoryRecordTable.projection_path, absPath)).get(),
  )
  const preservesDreamRecord = bodyType === "lfcode" && existing?.source === "dream" && existing.body === body
  Database.use((db) =>
    db
      .insert(MemoryRecordTable)
      .values({
        id: absPath,
        layer: bodyType === "cc" ? "external-import" : layerFor(loc.type),
        scope: loc.scope,
        scope_id: loc.scope_id,
        record_kind: finalType,
        source: bodyType === "cc" ? "claude-code" : preservesDreamRecord ? "dream" : "compat-projection",
        authority: bodyType === "cc" ? "external-readonly" : preservesDreamRecord ? "consolidated" : "legacy-writer",
        freshness: fingerprint,
        search_text: body,
        body,
        summary: summarize(body),
        projection_path: absPath,
        import_origin: bodyType === "cc" ? absPath : undefined,
        time_created: now,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: MemoryRecordTable.id,
        set: {
          layer: bodyType === "cc" ? "external-import" : layerFor(loc.type),
          scope: loc.scope,
          scope_id: loc.scope_id,
          record_kind: finalType,
          source: bodyType === "cc" ? "claude-code" : preservesDreamRecord ? "dream" : "compat-projection",
          authority: bodyType === "cc" ? "external-readonly" : preservesDreamRecord ? "consolidated" : "legacy-writer",
          freshness: fingerprint,
          search_text: body,
          body,
          summary: summarize(body),
          projection_path: absPath,
          import_origin: bodyType === "cc" ? absPath : null,
          time_updated: now,
        },
      })
      .run(),
  )
  return "updated"
}

export async function reconcileMemory(
  roots: { lfcode: string; cc?: string },
): Promise<{ indexed: number; pruned: number }> {
  // Collect disk paths from BOTH roots before pruning. If we pruned per-root,
  // enabling CC indexing on a fresh run would prune all Lfcode rows (and vice
  // versa) because each walk's set is missing the other root's paths.
  const lfcodeFiles = new Set(await walkMemoryDir(roots.lfcode))
  const ccFiles = roots.cc ? new Set(await walkCcRoot(roots.cc)) : new Set<string>()
  const diskPaths = new Set<string>([...lfcodeFiles, ...ccFiles])

  const indexed = new Map<string, string>(
    Database.use((db) =>
      db
        .select({ path: MemoryFtsTable.path, fingerprint: MemoryFtsTable.fingerprint })
        .from(MemoryFtsTable)
        .all(),
    ).map((r) => [r.path, r.fingerprint]),
  )

  // Direction B: prune dead FTS rows (any path not in either walk).
  let pruned = 0
  for (const p of indexed.keys()) {
    if (!diskPaths.has(p)) {
      Database.use((db) => db.delete(MemoryFtsTable).where(eq(MemoryFtsTable.path, p)).run())
      Database.use((db) => db.delete(MemoryRecordTable).where(eq(MemoryRecordTable.id, p)).run())
      pruned++
    }
  }

  // Direction A: index disk files. Pick parser by which walk produced the path.
  let indexedCount = 0
  for (const p of lfcodeFiles) {
    const loc = parsePath(p)
    if (!loc) {
      log.warn("path outside memory layout, skipping", { path: p })
      continue
    }
    const result = await indexFromDisk(p, loc, "lfcode", indexed.get(p))
    if (result === "updated") indexedCount++
  }
  for (const p of ccFiles) {
    const loc = parseCcPath(p)
    if (!loc) {
      log.warn("CC path failed to parse, skipping", { path: p })
      continue
    }
    const result = await indexFromDisk(p, loc, "cc", indexed.get(p))
    if (result === "updated") indexedCount++
  }

  return { indexed: indexedCount, pruned }
}

function layerFor(type: MemoryLocator["type"]) {
  if (type === "checkpoint" || type === "progress") return "session-recovery"
  if (type === "notes") return "scratch"
  return "durable-knowledge"
}

function summarize(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim()
  return normalized.length > 500 ? normalized.slice(0, 497) + "..." : normalized
}
