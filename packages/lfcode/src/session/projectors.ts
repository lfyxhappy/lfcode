import { NotFoundError, and, eq, sql } from "../storage"
import { SyncEvent } from "@/sync"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { Log } from "../util"
import { dropStoredPartBlob, isStoredBlobPart, storePartData } from "./part-blob"

const log = Log.create({ service: "session.projector" })

function foreign(err: unknown) {
  if (typeof err !== "object" || err === null) return false
  if ("code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true
  return "message" in err && typeof err.message === "string" && err.message.includes("FOREIGN KEY constraint failed")
}

function hasBlobReference(
  db: Parameters<Parameters<typeof SyncEvent.project>[1]>[0],
  blobPath: string,
  excludePartID?: string,
) {
  const refs = db
    .select({ id: PartTable.id })
    .from(PartTable)
    .where(
      and(
        sql`json_extract(${PartTable.data}, '$.blob.path') = ${blobPath}`,
        excludePartID ? sql`${PartTable.id} <> ${excludePartID}` : sql`1 = 1`,
      ),
    )
    .limit(1)
    .all()
  return refs.length > 0
}

function dropStoredPartBlobIfUnreferenced(
  db: Parameters<Parameters<typeof SyncEvent.project>[1]>[0],
  part: unknown,
  excludePartID?: string,
) {
  if (!isStoredBlobPart(part)) return
  if (hasBlobReference(db, part.blob.path, excludePartID)) return
  dropStoredPartBlob(part)
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> | null } : T

function grab<T extends object, K1 extends keyof T, X>(
  obj: T,
  field1: K1,
  cb?: (val: NonNullable<T[K1]>) => X,
): X | undefined {
  if (obj == undefined || !(field1 in obj)) return undefined

  const val = obj[field1]
  if (val && typeof val === "object" && cb) {
    return cb(val)
  }
  if (val === undefined) {
    throw new Error(
      "Session update failure: pass `null` to clear a field instead of `undefined`: " + JSON.stringify(obj),
    )
  }
  return val as X | undefined
}

export function toPartialRow(info: DeepPartial<Session.Info>) {
  const obj = {
    id: grab(info, "id"),
    project_id: grab(info, "projectID"),
    workspace_id: grab(info, "workspaceID"),
    parent_id: grab(info, "parentID"),
    context_from: grab(info, "contextFrom"),
    context_watermark: grab(info, "contextWatermark"),
    slug: grab(info, "slug"),
    directory: grab(info, "directory"),
    title: grab(info, "title"),
    version: grab(info, "version"),
    share_url: grab(info, "share", (v) => grab(v, "url")),
    summary_additions: grab(info, "summary", (v) => grab(v, "additions")),
    summary_deletions: grab(info, "summary", (v) => grab(v, "deletions")),
    summary_files: grab(info, "summary", (v) => grab(v, "files")),
    summary_diffs: grab(info, "summary", (v) => grab(v, "diffs")),
    revert: grab(info, "revert"),
    permission: grab(info, "permission"),
    goal: grab(info, "goal"),
    interaction: grab(info, "interaction"),
    compose_route: grab(info, "composeRoute"),
    time_created: grab(info, "time", (v) => grab(v, "created")),
    time_updated: grab(info, "time", (v) => grab(v, "updated")),
    time_last_user: grab(info, "time", (v) => grab(v, "lastUser")),
    time_compacting: grab(info, "time", (v) => grab(v, "compacting")),
    time_archived: grab(info, "time", (v) => grab(v, "archived")),
  }

  return Object.fromEntries(Object.entries(obj).filter(([_, val]) => val !== undefined))
}

export default [
  SyncEvent.project(Session.Event.Created, (db, data) => {
    db.insert(SessionTable).values(Session.toRow(data.info)).run()
  }),

  SyncEvent.project(Session.Event.Updated, (db, data) => {
    const info = data.info
    const row = db
      .update(SessionTable)
      .set(toPartialRow(info))
      .where(eq(SessionTable.id, data.sessionID))
      .returning()
      .get()
    if (!row) throw new NotFoundError({ message: `Session not found: ${data.sessionID}` })
  }),

  SyncEvent.project(Session.Event.Deleted, (db, data) => {
    const rows = db.select().from(PartTable).where(eq(PartTable.session_id, data.sessionID)).all()
    for (const row of rows) {
      dropStoredPartBlobIfUnreferenced(db, row.data, row.id)
    }
    db.delete(SessionTable).where(eq(SessionTable.id, data.sessionID)).run()
  }),

  SyncEvent.project(MessageV2.Event.Updated, (db, data) => {
    const time_created = data.info.time.created
    const { id, sessionID, agentID, ...rest } = data.info

    try {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          agent_id: agentID ?? "main",
          time_created,
          data: rest,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { agent_id: agentID ?? "main", data: rest } })
        .run()
    } catch (err) {
      if (!foreign(err)) throw err
      log.warn("ignored late message update", { messageID: id, sessionID })
    }
  }),

  SyncEvent.project(MessageV2.Event.Removed, (db, data) => {
    const rows = db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.message_id, data.messageID), eq(PartTable.session_id, data.sessionID)))
      .all()
    for (const row of rows) {
      dropStoredPartBlobIfUnreferenced(db, row.data, row.id)
    }
    db.delete(MessageTable)
      .where(and(eq(MessageTable.id, data.messageID), eq(MessageTable.session_id, data.sessionID)))
      .run()
  }),

  SyncEvent.project(MessageV2.Event.PartRemoved, (db, data) => {
    const row = db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.id, data.partID), eq(PartTable.session_id, data.sessionID)))
      .get()
    if (row) dropStoredPartBlobIfUnreferenced(db, row.data, row.id)
    db.delete(PartTable)
      .where(and(eq(PartTable.id, data.partID), eq(PartTable.session_id, data.sessionID)))
      .run()
  }),

  SyncEvent.project(MessageV2.Event.PartUpdated, (db, data) => {
    const { id, messageID, sessionID, ...raw } = data.part
    const rest = storePartData(raw)
    const previous = db.select().from(PartTable).where(eq(PartTable.id, id)).get()
    if (
      previous &&
      isStoredBlobPart(previous.data) &&
      (!isStoredBlobPart(rest) || previous.data.blob.path !== rest.blob.path)
    ) {
      dropStoredPartBlobIfUnreferenced(db, previous.data, previous.id)
    }

    try {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: data.time,
          data: rest,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data: rest } })
        .run()
    } catch (err) {
      if (!foreign(err)) throw err
      log.warn("ignored late part update", { partID: id, messageID, sessionID })
    }
  }),
]
