import { Context, Effect, Layer } from "effect"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { Database } from "../storage"
import { MessageTable, PartTable, SessionTable } from "../session/session.sql"
import { ActorRegistryTable } from "../actor/actor.sql"
import { ActorDispatchTable } from "../actor/dispatch.sql"
import { BackgroundJobTable } from "../background-job/background-job.sql"
import { EventTable } from "../sync/event.sql"
import type { MessageID, SessionID } from "../session/schema"
import { Config } from "../config"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { buildFtsQuery } from "./fts-query"
import type { Kind } from "./extract"
import { layer as writerLayer, Service as WriterService } from "./writer"
import { layer as backfillLayer, Service as BackfillService } from "./backfill"
import { Log } from "../util"
import { userVisibleActorClause } from "../actor/visibility"

const HIDDEN_REVIEWER_SQL = userVisibleActorClause(MessageTable.agent_id)

export type SearchHit = {
  part_id: string
  session_id: string
  message_id: string
  project_id: string
  kind: Kind
  tool_name: string | null
  snippet: string
  score: number
  time_created: number
}

export type MessagePart = {
  part_id: string
  type: string
  role: "user" | "assistant"
  tool_name: string | null
  text: string
}

export type MessageContext = {
  role: "user" | "assistant"
  message_id: string
  matched: boolean
  time_created: number
  parts: MessagePart[]
}

export type SessionTrace = {
  session_found: boolean
  session_id: string
  project_id?: string
  parent_id?: string
  context_from?: string
  children: { session_id: string; title: string; time_created: number }[]
  actors: { actor_id: string; parent_actor_id?: string; agent: string; status: string; last_outcome?: string }[]
  dispatches: { id: string; actor_id: string; parent_actor_id?: string; description: string; status: string; unread: boolean }[]
  jobs: { id: string; kind: string; title: string; status: string; completed_at?: number }[]
}

export type SessionEvent = {
  event_id: string
  session_id: string
  sequence: number
  type: string
  data: Record<string, unknown>
}

export type EventSearch = {
  session_found: boolean
  session_id: string
  project_id?: string
  events: SessionEvent[]
}

export type EventRead = {
  session_found: boolean
  event_found: boolean
  session_id: string
  project_id?: string
  event?: SessionEvent
}

export interface Interface {
  readonly search: (input: {
    query: string
    scope?: "project" | "global"
    session_id?: string
    kind?: Kind | Kind[]
    tool_name?: string
    time_after?: number
    time_before?: number
    limit?: number
  }) => Effect.Effect<SearchHit[]>

  readonly around: (input: {
    message_id: string
    before?: number
    after?: number
  }) => Effect.Effect<{ session_id: string; project_id?: string; messages: MessageContext[] }>

  readonly session: (input: {
    session_id: string
    agent_scope?: "main" | "all"
    limit?: number
    include_boundaries?: boolean
  }) => Effect.Effect<{
    session_found: boolean
    checkpoint_found: boolean
    session_id: string
    project_id?: string
    messages: MessageContext[]
  }>

  readonly trace: (input: { session_id: string }) => Effect.Effect<SessionTrace>

  readonly eventSearch: (input: {
    session_id: string
    query?: string
    type?: string
    limit?: number
  }) => Effect.Effect<EventSearch>

  readonly eventRead: (input: { session_id: string; sequence: number }) => Effect.Effect<EventRead>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/History") {}

const HARD_CAP = 50
const EVENT_HARD_CAP = 100
const log = Log.create({ service: "history" })

const SENSITIVE_EVENT_KEY = /token|secret|authorization|cookie|password/i

type Row = {
  part_id: string
  session_id: string
  message_id: string
  project_id: string
  kind: string
  tool_name: string | null
  snippet: string
  score: number
  time_created: number
}

export const defaultLayer: Layer.Layer<Service | WriterService | BackfillService, never, never> = Layer.suspend(() =>
  Layer.mergeAll(layer, writerLayer, backfillLayer).pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Bus.defaultLayer),
  ),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const search = Effect.fn("History.search")(function* (input: Parameters<Interface["search"]>[0]) {
      const ftsQuery = buildFtsQuery(input.query)
      if (!ftsQuery) return []

      const limit = Math.min(input.limit ?? 10, HARD_CAP)
      const conditions: string[] = []
      const params: (string | number)[] = []

      // FTS rows predate the hidden-actor boundary in existing profiles. Keep
      // this join-time guard even after backfill cleanup so stale rows can
      // never be returned while an upgrade is in progress.
      conditions.push("NOT EXISTS (SELECT 1 FROM message WHERE message.id = history_fts.message_id AND (message.agent_id = 'context-reviewer' OR message.agent_id LIKE 'context-reviewer-%'))")

      const scope = input.scope ?? "project"
      if (scope === "project") {
        conditions.push("history_fts.project_id = ?")
        params.push(Instance.project.id)
      }

      if (input.session_id) {
        conditions.push("history_fts.session_id = ?")
        params.push(input.session_id)
      }
      if (input.kind) {
        const kinds = Array.isArray(input.kind) ? input.kind : [input.kind]
        conditions.push(`history_fts.kind IN (${kinds.map(() => "?").join(",")})`)
        for (const k of kinds) params.push(k)
      }
      if (input.tool_name) {
        conditions.push("history_fts.tool_name = ?")
        params.push(input.tool_name)
      }
      if (input.time_after !== undefined) {
        conditions.push("history_fts.time_created >= ?")
        params.push(input.time_after)
      }
      if (input.time_before !== undefined) {
        conditions.push("history_fts.time_created <= ?")
        params.push(input.time_before)
      }

      const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""
      const sqlText = `
        SELECT history_fts.part_id, history_fts.session_id, history_fts.message_id,
               history_fts.project_id, history_fts.kind, history_fts.tool_name,
               history_fts.time_created,
               snippet(history_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
               bm25(history_fts_idx) AS score
        FROM history_fts_idx
        JOIN history_fts ON history_fts.rowid = history_fts_idx.rowid
        WHERE history_fts_idx MATCH ?
        ${whereClause}
        ORDER BY score
        LIMIT ?
      `
      const rows = Database.rawAll<Row>(sqlText, ftsQuery, ...params, limit)
      return rows.map((r) => ({
        part_id: r.part_id,
        session_id: r.session_id,
        message_id: r.message_id,
        project_id: r.project_id,
        kind: r.kind as Kind,
        tool_name: r.tool_name,
        snippet: r.snippet,
        score: -r.score,
        time_created: r.time_created,
      }))
    })

    const around = Effect.fn("History.around")(function* (input: Parameters<Interface["around"]>[0]) {
      const before = input.before ?? 5
      const after = input.after ?? 5
      const anchor = Database.use((db) =>
        db
          .select({
            id: MessageTable.id,
            session_id: MessageTable.session_id,
            time_created: MessageTable.time_created,
          })
          .from(MessageTable)
          .where(and(eq(MessageTable.id, input.message_id as MessageID), HIDDEN_REVIEWER_SQL))
          .get(),
      )
      if (!anchor) return { session_id: "", messages: [] }
      const session = Database.use((db) =>
        db
          .select({ project_id: SessionTable.project_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, anchor.session_id))
          .get(),
      )

      const beforeRows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(
            and(
              eq(MessageTable.session_id, anchor.session_id),
              HIDDEN_REVIEWER_SQL,
              sql`(${MessageTable.time_created} < ${anchor.time_created} OR (${MessageTable.time_created} = ${anchor.time_created} AND ${MessageTable.id} <= ${anchor.id}))`,
            ),
          )
          .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
          .limit(before + 1)
          .all(),
      )
      const afterRows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(
            and(
              eq(MessageTable.session_id, anchor.session_id),
              HIDDEN_REVIEWER_SQL,
              sql`(${MessageTable.time_created} > ${anchor.time_created} OR (${MessageTable.time_created} = ${anchor.time_created} AND ${MessageTable.id} > ${anchor.id}))`,
            ),
          )
          .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
          .limit(after)
          .all(),
      )

      const messages = [...beforeRows.reverse(), ...afterRows]
      if (messages.length === 0) {
        return { session_id: anchor.session_id, project_id: session?.project_id, messages: [] }
      }
      const parts = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, anchor.session_id),
              sql`${PartTable.message_id} IN (${sql.join(
                messages.map((m) => sql`${m.id}`),
                sql`, `,
              )})`,
            ),
          )
          .orderBy(asc(PartTable.message_id), asc(PartTable.id))
          .all(),
      )

      const byMessage = new Map<string, typeof parts>()
      for (const p of parts) {
        const list = byMessage.get(p.message_id) ?? []
        list.push(p)
        byMessage.set(p.message_id, list)
      }

      const out: MessageContext[] = messages.map((m) => {
        const role: "user" | "assistant" =
          (m.data as { role?: "user" | "assistant" })?.role === "user" ? "user" : "assistant"
        const partsHere = (byMessage.get(m.id) ?? []).map((p) => {
          const d = p.data as {
            type: string
            text?: string
            tool?: string
            state?: { input?: unknown; output?: unknown; error?: string }
          }
          const text =
            d.type === "text" || d.type === "reasoning"
              ? (d.text ?? "")
              : d.type === "tool"
                ? `tool: ${d.tool ?? ""}\ninput: ${JSON.stringify(d.state?.input ?? {})}\n${d.state?.error ? `error: ${d.state.error}` : `output: ${JSON.stringify(d.state?.output ?? "")}`}`
                : `[${d.type}]`
          return {
            part_id: p.id,
            type: d.type,
            role,
            tool_name: d.type === "tool" ? (d.tool ?? null) : null,
            text,
          }
        })
        return {
          role,
          message_id: m.id,
          matched: m.id === input.message_id,
          time_created: m.time_created,
          parts: partsHere,
        }
      })

      return { session_id: anchor.session_id, project_id: session?.project_id, messages: out }
    })

    const trace = Effect.fn("History.trace")(function* (input: Parameters<Interface["trace"]>[0]) {
      const session = Database.use((db) =>
        db
          .select({
            id: SessionTable.id,
            project_id: SessionTable.project_id,
            parent_id: SessionTable.parent_id,
            context_from: SessionTable.context_from,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.session_id as SessionID))
          .get(),
      )
      if (!session) {
        return {
          session_found: false,
          session_id: input.session_id,
          children: [],
          actors: [],
          dispatches: [],
          jobs: [],
        }
      }
      const children = Database.use((db) =>
        db
          .select({ session_id: SessionTable.id, title: SessionTable.title, time_created: SessionTable.time_created })
          .from(SessionTable)
          .where(eq(SessionTable.parent_id, session.id))
          .orderBy(asc(SessionTable.time_created))
          .all(),
      )
      const actors = Database.use((db) =>
        db
          .select({
            actor_id: ActorRegistryTable.actor_id,
            parent_actor_id: ActorRegistryTable.parent_actor_id,
            agent: ActorRegistryTable.agent,
            status: ActorRegistryTable.status,
            last_outcome: ActorRegistryTable.last_outcome,
          })
          .from(ActorRegistryTable)
          .where(eq(ActorRegistryTable.session_id, session.id))
          .all()
          .map(({ parent_actor_id, last_outcome, ...item }) => ({
            ...item,
            ...(parent_actor_id ? { parent_actor_id } : {}),
            ...(last_outcome ? { last_outcome } : {}),
          })),
      )
      const dispatches = Database.use((db) =>
        db
          .select({
            id: ActorDispatchTable.id,
            actor_id: ActorDispatchTable.actor_id,
            parent_actor_id: ActorDispatchTable.parent_actor_id,
            description: ActorDispatchTable.description,
            status: ActorDispatchTable.status,
            unread: ActorDispatchTable.unread,
          })
          .from(ActorDispatchTable)
          .where(eq(ActorDispatchTable.session_id, session.id))
          .orderBy(desc(ActorDispatchTable.time_created))
          .all()
          .map(({ parent_actor_id, ...item }) => ({ ...item, ...(parent_actor_id ? { parent_actor_id } : {}) })),
      )
      const jobs = Database.use((db) =>
        db
          .select({
            id: BackgroundJobTable.id,
            kind: BackgroundJobTable.kind,
            title: BackgroundJobTable.title,
            status: BackgroundJobTable.status,
            completed_at: BackgroundJobTable.completed_at,
          })
          .from(BackgroundJobTable)
          .where(eq(BackgroundJobTable.session_id, session.id))
          .orderBy(desc(BackgroundJobTable.time_created))
          .all()
          .map(({ completed_at, ...item }) => ({ ...item, ...(completed_at ? { completed_at } : {}) })),
      )
      return {
        session_found: true,
        session_id: session.id,
        project_id: session.project_id,
        ...(session.parent_id ? { parent_id: session.parent_id } : {}),
        ...(session.context_from ? { context_from: session.context_from } : {}),
        children,
        actors,
        dispatches,
        jobs,
      }
    })

    const eventSearch = Effect.fn("History.eventSearch")(function* (input: Parameters<Interface["eventSearch"]>[0]) {
      const session = findSession(input.session_id)
      if (!session) return { session_found: false, session_id: input.session_id, events: [] }

      const rows = Database.use((db) =>
        db
          .select({
            event_id: EventTable.id,
            session_id: EventTable.aggregate_id,
            sequence: EventTable.seq,
            type: EventTable.type,
            data: EventTable.data,
          })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, input.session_id),
              ...(input.type ? [eq(EventTable.type, input.type)] : []),
              ...(input.query
                ? [sql`lower(CAST(${EventTable.data} AS TEXT)) LIKE lower(${`%${escapeLike(input.query)}%`}) ESCAPE '\\'`]
                : []),
            ),
          )
          .orderBy(asc(EventTable.seq))
          .limit(Math.min(input.limit ?? EVENT_HARD_CAP, EVENT_HARD_CAP))
          .all(),
      )
      return {
        session_found: true,
        session_id: input.session_id,
        project_id: session.project_id,
        events: rows.map(sanitizeEvent),
      }
    })

    const eventRead = Effect.fn("History.eventRead")(function* (input: Parameters<Interface["eventRead"]>[0]) {
      const session = findSession(input.session_id)
      if (!session) return { session_found: false, event_found: false, session_id: input.session_id }

      const event = Database.use((db) =>
        db
          .select({
            event_id: EventTable.id,
            session_id: EventTable.aggregate_id,
            sequence: EventTable.seq,
            type: EventTable.type,
            data: EventTable.data,
          })
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, input.session_id), eq(EventTable.seq, input.sequence)))
          .get(),
      )
      if (!event) {
        return {
          session_found: true,
          event_found: false,
          session_id: input.session_id,
          project_id: session.project_id,
        }
      }
      return {
        session_found: true,
        event_found: true,
        session_id: input.session_id,
        project_id: session.project_id,
        event: sanitizeEvent(event),
      }
    })

    const session = Effect.fn("History.session")(function* (input: Parameters<Interface["session"]>[0]) {
      const limit = Math.min(input.limit ?? 200, 500)
      const sessionID = input.session_id as SessionID
      const sessionRow = Database.use((db) =>
        db
          .select({
          id: SessionTable.id,
          project_id: SessionTable.project_id,
          last_checkpoint_message_id: SessionTable.last_checkpoint_message_id,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get(),
      )
      if (!sessionRow) {
        log.info("history_session_lookup", {
          sessionID: input.session_id,
          agentScope: input.agent_scope ?? "main",
          includeBoundaries: input.include_boundaries ?? true,
          limit,
          sessionFound: false,
          checkpointFound: false,
          messageCount: 0,
        })
        return {
          session_found: false,
          checkpoint_found: false,
          session_id: input.session_id,
          messages: [],
        }
      }

      const base = [eq(MessageTable.session_id, sessionID), HIDDEN_REVIEWER_SQL]
      const scope = input.agent_scope ?? "main"
      if (scope === "main") base.push(eq(MessageTable.agent_id, "main"))
      const rows = Database.use((db) =>
        db
          .select({ id: MessageTable.id, time_created: MessageTable.time_created, data: MessageTable.data })
          .from(MessageTable)
          .where(and(...base))
          .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
          .limit(limit)
          .all(),
      ).reverse()
      if (rows.length === 0) {
        log.info("history_session_lookup", {
          sessionID: input.session_id,
          agentScope: scope,
          includeBoundaries: input.include_boundaries ?? true,
          limit,
          sessionFound: true,
          checkpointFound: !!sessionRow.last_checkpoint_message_id,
          messageCount: 0,
        })
        return {
          session_found: true,
          checkpoint_found: !!sessionRow.last_checkpoint_message_id,
          session_id: input.session_id,
          project_id: sessionRow.project_id,
          messages: [],
        }
      }

      const messageIDs = rows.map((m) => m.id)
      const parts = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.session_id, sessionID), inArray(PartTable.message_id, messageIDs)))
          .orderBy(asc(PartTable.message_id), asc(PartTable.id))
          .all(),
      )
      const byMessage = new Map<string, typeof parts>()
      for (const p of parts) {
        const list = byMessage.get(p.message_id) ?? []
        list.push(p)
        byMessage.set(p.message_id, list)
      }

      const messages = rows.map((m) => {
        const role: "user" | "assistant" =
          (m.data as { role?: "user" | "assistant" })?.role === "user" ? "user" : "assistant"
        return {
          role,
          message_id: m.id,
          matched: false,
          time_created: m.time_created,
          parts: (byMessage.get(m.id) ?? []).map((p) => {
            const d = p.data as {
              type: string
              text?: string
              tool?: string
              state?: { input?: unknown; output?: unknown; error?: string }
            }
            const text =
              d.type === "text" || d.type === "reasoning"
                ? (d.text ?? "")
                : d.type === "tool"
                  ? `tool: ${d.tool ?? ""}\ninput: ${JSON.stringify(d.state?.input ?? {})}\n${d.state?.error ? `error: ${d.state.error}` : `output: ${JSON.stringify(d.state?.output ?? "")}`}`
                  : `[${d.type}]`
            return {
              part_id: p.id,
              type: d.type,
              role,
              tool_name: d.type === "tool" ? (d.tool ?? null) : null,
              text,
            }
          }),
        }
      })

      const checkpoint_found =
        !!sessionRow.last_checkpoint_message_id ||
        messages.some(
          (message) =>
            message.parts.some((part) => part.type === "checkpoint") ||
            message.parts.some((part) => part.type === "text" && part.text.includes("Summary of previous conversation from checkpoint files:")),
        )

      const filtered =
        input.include_boundaries === false
          ? messages.filter(
              (message) => !message.parts.some((part) => part.type === "checkpoint" || part.type === "compaction"),
            )
          : messages

      log.info("history_session_lookup", {
        sessionID: input.session_id,
        agentScope: scope,
        includeBoundaries: input.include_boundaries ?? true,
        limit,
        sessionFound: true,
        checkpointFound: checkpoint_found,
        messageCount: filtered.length,
      })

      return {
        session_found: true,
        checkpoint_found,
        session_id: input.session_id,
        project_id: sessionRow.project_id,
        messages: filtered,
      }
    })

    return Service.of({ search, around, session, trace, eventSearch, eventRead })
  }),
)

function findSession(sessionID: string) {
  return Database.use((db) =>
    db
      .select({ project_id: SessionTable.project_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID as SessionID))
      .get(),
  )
}

function escapeLike(query: string) {
  return query.replace(/[\\%_]/g, "\\$&")
}

function sanitizeEvent(event: {
  event_id: string
  session_id: string
  sequence: number
  type: string
  data: Record<string, unknown>
}): SessionEvent {
  return {
    ...event,
    data: sanitizeEventData(event.data) as Record<string, unknown>,
  }
}

function sanitizeEventData(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(sanitizeEventData)
  if (typeof value !== "object") return null
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SENSITIVE_EVENT_KEY.test(key) ? "[REDACTED]" : sanitizeEventData(item)]),
  )
}
