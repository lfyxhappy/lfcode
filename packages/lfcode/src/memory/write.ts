import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Database } from "../storage"
import { MemoryFtsTable } from "./fts.sql"
import { buildPath } from "./paths"
import { MemoryRecordTable } from "./record.sql"

export type ProjectMemoryWrite = {
  projectID: string
  key: string
  body: string
  summary?: string
}

export type ProjectMemoryWriteResult = {
  path: string
  freshness: string
}

export async function writeProjectMemory(input: ProjectMemoryWrite, root: string): Promise<ProjectMemoryWriteResult> {
  if (!/^MEMORY(?:-[a-z0-9][a-z0-9-]*)?$/i.test(input.key)) {
    throw new Error("Dream records must use MEMORY.md or MEMORY-<topic>.md")
  }
  const body = input.body.trim() + "\n"
  if (body.length < 8) throw new Error("Dream memory records cannot be empty")

  const projectionPath = buildPath({ root, scope: "projects", scope_id: input.projectID, key: input.key })
  const freshness = createHash("sha256").update(body).digest("hex")
  const now = Date.now()
  const summary = input.summary?.trim() || summarize(body)

  // The typed record is committed before its Markdown compatibility projection.
  Database.use((db) =>
    db
      .insert(MemoryRecordTable)
      .values({
        id: projectionPath,
        layer: "durable-knowledge",
        scope: "projects",
        scope_id: input.projectID,
        record_kind: "memory",
        source: "dream",
        authority: "consolidated",
        freshness,
        search_text: body,
        body,
        summary,
        projection_path: projectionPath,
        time_created: now,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: MemoryRecordTable.id,
        set: {
          layer: "durable-knowledge",
          scope: "projects",
          scope_id: input.projectID,
          record_kind: "memory",
          source: "dream",
          authority: "consolidated",
          freshness,
          search_text: body,
          body,
          summary,
          projection_path: projectionPath,
          import_origin: null,
          time_updated: now,
        },
      })
      .run(),
  )

  Database.use((db) =>
    db
      .insert(MemoryFtsTable)
      .values({
        path: projectionPath,
        scope: "projects",
        scope_id: input.projectID,
        type: "memory",
        body,
        fingerprint: freshness,
        last_indexed_at: now,
      })
      .onConflictDoUpdate({
        target: MemoryFtsTable.path,
        set: {
          scope: "projects",
          scope_id: input.projectID,
          type: "memory",
          body,
          fingerprint: freshness,
          last_indexed_at: now,
        },
      })
      .run(),
  )

  await fs.mkdir(path.dirname(projectionPath), { recursive: true })
  await fs.writeFile(projectionPath, body, "utf-8")
  return { path: projectionPath, freshness }
}

function summarize(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim()
  return normalized.length > 500 ? normalized.slice(0, 497) + "..." : normalized
}
