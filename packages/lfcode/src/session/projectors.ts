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

function numberAt(data: unknown, path: string[]) {
  let value = data
  for (const key of path) {
    if (!value || typeof value !== "object") return 0
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function stringAt(data: unknown, path: string[]) {
  let value = data
  for (const key of path) {
    if (!value || typeof value !== "object") return ""
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === "string" ? value : ""
}

function optionalDuration(data: unknown) {
  const start = numberAt(data, ["time", "start"])
  const end = numberAt(data, ["time", "end"])
  if (!start && !end) return null
  return Math.max(0, end - start)
}

function upsertUsageFact(
  db: Parameters<Parameters<typeof SyncEvent.project>[1]>[0],
  input: { part: { id: string; messageID: string; sessionID: string; time: number; data: unknown } },
) {
  if (stringAt(input.part.data, ["type"]) !== "step-finish") {
    db.run(sql`DELETE FROM usage_fact WHERE part_id = ${input.part.id}`)
    return
  }
  const message = db.select().from(MessageTable).where(eq(MessageTable.id, input.part.messageID as never)).get()
  const session = db.select().from(SessionTable).where(eq(SessionTable.id, input.part.sessionID as never)).get()
  if (!message || !session) return
  const overheadTokens =
    numberAt(input.part.data, ["overhead", "tokens", "input"]) +
    numberAt(input.part.data, ["overhead", "tokens", "output"]) +
    numberAt(input.part.data, ["overhead", "tokens", "reasoning"]) +
    numberAt(input.part.data, ["overhead", "tokens", "cache", "read"]) +
    numberAt(input.part.data, ["overhead", "tokens", "cache", "write"])
  const values = {
    input: numberAt(input.part.data, ["tokens", "input"]),
    output: numberAt(input.part.data, ["tokens", "output"]),
    reasoning: numberAt(input.part.data, ["tokens", "reasoning"]),
    cacheRead: numberAt(input.part.data, ["tokens", "cache", "read"]),
    cacheWrite: numberAt(input.part.data, ["tokens", "cache", "write"]),
    cost: numberAt(input.part.data, ["cost"]),
    overheadCost: numberAt(input.part.data, ["overhead", "cost"]),
    status: stringAt(input.part.data, ["status"]) || "completed",
    duration: optionalDuration(input.part.data),
    ttft: numberAt(input.part.data, ["time", "ttft"]) || null,
    submitToFirstDelta: numberAt(input.part.data, ["time", "submit_to_first_delta"]) || null,
    preStream: numberAt(input.part.data, ["time", "pre_stream"]) || null,
  }
  db.run(sql`INSERT INTO usage_fact (
    part_id, message_id, session_id, project_id, time_created, agent_id, provider_id, model_id, status,
    variant, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, overhead_tokens,
    cost, overhead_cost, duration, ttft, submit_to_first_delta, pre_stream
  ) VALUES (
    ${input.part.id}, ${input.part.messageID}, ${input.part.sessionID}, ${session.project_id}, ${input.part.time},
    ${message.agent_id}, ${stringAt(message.data, ["providerID"])}, ${stringAt(message.data, ["modelID"])}, ${values.status}, ${stringAt(message.data, ["variant"]) || null},
    ${values.input}, ${values.output}, ${values.reasoning}, ${values.cacheRead}, ${values.cacheWrite}, ${overheadTokens},
    ${values.cost}, ${values.overheadCost}, ${values.duration}, ${values.ttft}, ${values.submitToFirstDelta}, ${values.preStream}
  ) ON CONFLICT(part_id) DO UPDATE SET
    message_id=excluded.message_id, session_id=excluded.session_id, project_id=excluded.project_id,
    time_created=excluded.time_created, agent_id=excluded.agent_id, provider_id=excluded.provider_id,
    model_id=excluded.model_id, variant=excluded.variant, status=excluded.status, input_tokens=excluded.input_tokens,
    output_tokens=excluded.output_tokens, reasoning_tokens=excluded.reasoning_tokens,
    cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
    overhead_tokens=excluded.overhead_tokens, cost=excluded.cost, overhead_cost=excluded.overhead_cost,
    duration=excluded.duration, ttft=excluded.ttft, submit_to_first_delta=excluded.submit_to_first_delta,
    pre_stream=excluded.pre_stream`)
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
    temporary: info.temporary === undefined ? undefined : info.temporary === null ? null : info.temporary ? 1 : 0,
    share_url: grab(info, "share", (v) => grab(v, "url")),
    summary_additions: grab(info, "summary", (v) => grab(v, "additions")),
    summary_deletions: grab(info, "summary", (v) => grab(v, "deletions")),
    summary_files: grab(info, "summary", (v) => grab(v, "files")),
    summary_diffs: grab(info, "summary", (v) => grab(v, "diffs")),
    revert: grab(info, "revert"),
    permission: grab(info, "permission"),
    goal: grab(info, "goal"),
    interaction: grab(info, "interaction"),
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
    db.run(sql`DELETE FROM usage_fact WHERE session_id = ${data.sessionID}`)
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
      const session = db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
      if (session) {
        const parts = db.select().from(PartTable).where(eq(PartTable.message_id, id)).all()
        for (const part of parts) {
          upsertUsageFact(db, { part: { id: part.id, messageID: id, sessionID: sessionID, time: part.time_created, data: part.data } })
        }
      }
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
    db.run(sql`DELETE FROM usage_fact WHERE message_id = ${data.messageID}`)
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
    db.run(sql`DELETE FROM usage_fact WHERE part_id = ${data.partID}`)
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
      upsertUsageFact(db, { part: { id, messageID, sessionID, time: data.time, data: rest } })
    } catch (err) {
      if (!foreign(err)) throw err
      log.warn("ignored late part update", { partID: id, messageID, sessionID })
    }
  }),
]
