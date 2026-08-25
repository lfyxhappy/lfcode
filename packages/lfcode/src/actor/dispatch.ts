import { Context, Effect, Layer } from "effect"
import z from "zod"
import { ulid } from "ulid"
import { and, asc, desc, eq, inArray, Database } from "@/storage"
import { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { ContextMode, ToolWhitelist } from "./schema"
import { ActorDispatchSettingsTable, ActorDispatchTable, type ActorDispatchStatus } from "./dispatch.sql"
import { dispatchRef } from "./dispatch-ref"
import { Snapshot as ResearchDispatchSnapshot } from "@/research/dispatch"

const DEFAULT_BACKGROUND_CONCURRENCY = 4
const SETTINGS_ID = "global"
const TERMINAL = new Set<ActorDispatchStatus>(["completed", "failed", "cancelled"])
const NONTERMINAL = new Set<ActorDispatchStatus>(["queued", "running", "interrupted"])

const Model = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

const FileList = z.array(z.string().min(1).max(4096).refine((value) => !value.includes("\0"))).max(128)

export const Payload = z.object({
  parentSessionID: z.string().optional(),
  parentActorID: z.string().optional(),
  agent: z.string().min(1),
  task: z.string().min(1),
  description: z.string().min(1),
  context: ContextMode,
  tools: ToolWhitelist,
  model: Model.optional(),
  taskID: z.string().optional(),
  cwd: z.string().optional(),
  parentAgent: z.string().optional(),
  parentModel: Model.optional(),
  contextRefs: z.array(z.string().min(1).max(4096)).max(128).optional(),
  declaredFiles: FileList.optional(),
  research: ResearchDispatchSnapshot.optional(),
  // Background work may require a structured terminal result. Preserve the
  // requested format through dispatch so workers observe the same contract as
  // immediate foreground actors.
  format: MessageV2.Format.optional(),
})
export type Payload = z.infer<typeof Payload>

export const Status = z.enum(["queued", "running", "interrupted", "completed", "failed", "cancelled"])
export type Status = z.infer<typeof Status>

export const Info = z
  .object({
    id: z.string(),
    sessionID: SessionID.zod,
    actorID: z.string(),
    parentActorID: z.string().optional(),
    agent: z.string(),
    description: z.string(),
    status: Status,
    execution: z.literal("background"),
    context: ContextMode,
    model: Model.optional(),
    contextRefs: z.array(z.string()),
    declaredFiles: z.array(z.string()),
    actualFiles: z.array(z.string()),
    research: ResearchDispatchSnapshot.optional(),
    writeAccess: z.boolean(),
    conflicts: z.array(z.string()),
    queuePosition: z.number().int().positive().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    unread: z.boolean(),
    acknowledgedAt: z.number().optional(),
    manualResume: z.boolean(),
    resumedFrom: z.string().optional(),
    attempt: z.number().int().positive(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      started: z.number().optional(),
      completed: z.number().optional(),
    }),
  })
  .meta({ ref: "ActorDispatch" })
export type Info = z.infer<typeof Info>

export const Config = z
  .object({
    backgroundConcurrency: z.number().int().min(1).max(8),
  })
  .meta({ ref: "ActorDispatchConfig" })
export type Config = z.infer<typeof Config>

export type Record = Info & { payload: Payload }

type Row = typeof ActorDispatchTable.$inferSelect

function normalized(values: readonly string[] | undefined) {
  if (!values) return []
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function researchPayload(payload: Payload, input: {
  phase: z.infer<typeof ResearchDispatchSnapshot>["phase"]
  subtaskCount?: number
  startedAt?: number
  completedAt?: number
  result?: string
}) {
  if (!payload.research) return payload
  const citations = [...new Set([...(payload.research.citations ?? []), ...(input.result?.match(/https?:\/\/[^\s)>\]}]+/g) ?? [])])]
  return {
    ...payload,
    research: {
      ...payload.research,
      phase: input.phase,
      citations,
      subtaskCount: Math.max(payload.research.subtaskCount, input.subtaskCount ?? 0),
      sourceCount: Math.max(payload.research.sourceCount, citations.length),
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.result ? { summary: input.result.slice(0, 12000) } : {}),
    },
  }
}

function knownFiles(row: Row) {
  return normalized([...(row.declared_files ?? []), ...(row.actual_files ?? [])])
}

function conflicts(row: Row, rows: readonly Row[]) {
  if (!row.write_access || !NONTERMINAL.has(row.status)) return []
  const files = new Set(knownFiles(row))
  if (files.size === 0) return []
  return rows
    .filter(
      (other) =>
        other.id !== row.id &&
        other.write_access &&
        NONTERMINAL.has(other.status) &&
        knownFiles(other).some((file) => files.has(file)),
    )
    .map((other) => other.id)
}

function queuePosition(row: Row, rows: readonly Row[]) {
  if (row.status !== "queued") return
  return (
    rows
      .filter(
        (other) =>
          other.status === "queued" &&
          (other.time_created < row.time_created ||
            (other.time_created === row.time_created && other.id <= row.id)),
      )
      .length
  )
}

function fromRow(row: Row, rows: readonly Row[] = [row]): Record {
  const payload = Payload.parse(row.payload)
  return {
    id: row.id,
    sessionID: row.session_id,
    actorID: row.actor_id,
    ...(row.parent_actor_id ? { parentActorID: row.parent_actor_id } : {}),
    agent: row.agent,
    description: row.description,
    status: row.status,
    execution: row.execution,
    context: row.context_mode,
    ...(row.model ? { model: row.model } : {}),
    contextRefs: row.context_refs ?? [],
    declaredFiles: row.declared_files ?? [],
    actualFiles: row.actual_files ?? [],
    ...(payload.research ? { research: payload.research } : {}),
    writeAccess: row.write_access,
    conflicts: conflicts(row, rows),
    ...(queuePosition(row, rows) ? { queuePosition: queuePosition(row, rows) } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.error ? { error: row.error } : {}),
    unread: row.unread,
    ...(row.acknowledged_at !== null && row.acknowledged_at !== undefined
      ? { acknowledgedAt: row.acknowledged_at }
      : {}),
    manualResume: row.manual_resume,
    ...(row.resumed_from ? { resumedFrom: row.resumed_from } : {}),
    attempt: row.attempt,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_started !== null && row.time_started !== undefined ? { started: row.time_started } : {}),
      ...(row.time_completed !== null && row.time_completed !== undefined
        ? { completed: row.time_completed }
        : {}),
    },
    payload,
  }
}

function readConfig() {
  const row = Database.use((db) =>
    db.select().from(ActorDispatchSettingsTable).where(eq(ActorDispatchSettingsTable.id, SETTINGS_ID)).get(),
  )
  return { backgroundConcurrency: row?.background_concurrency ?? DEFAULT_BACKGROUND_CONCURRENCY }
}

export interface Interface {
  readonly enqueue: (input: {
    sessionID: SessionID
    actorID: string
    parentActorID?: string
    agent: string
    description: string
    context: z.infer<typeof ContextMode>
    model?: z.infer<typeof Model>
    contextRefs?: readonly string[]
    declaredFiles?: readonly string[]
    writeAccess: boolean
    payload: Payload
    resumedFrom?: string
    attempt?: number
  }) => Effect.Effect<Record>
  readonly claimNext: (sessionID: SessionID) => Effect.Effect<Record | undefined>
  readonly complete: (input: {
    id: string
    status: "completed" | "failed" | "cancelled"
    subtaskCount?: number
    result?: string
    error?: string
  }) => Effect.Effect<Record | undefined>
  readonly updateResearch: (input: {
    id: string
    phase: z.infer<typeof ResearchDispatchSnapshot>["phase"]
    subtaskCount?: number
  }) => Effect.Effect<Record | undefined>
  readonly cancel: (input: { sessionID: SessionID; actorID?: string; id?: string; reason?: string }) => Effect.Effect<Record | undefined>
  readonly get: (id: string) => Effect.Effect<Record | undefined>
  readonly getForSession: (sessionID: SessionID, id: string) => Effect.Effect<Record | undefined>
  readonly list: (sessionID: SessionID) => Effect.Effect<Record[]>
  readonly receive: (sessionID: SessionID, id: string) => Effect.Effect<Record | undefined>
  readonly resume: (sessionID: SessionID, id: string) => Effect.Effect<Record | undefined>
  readonly recordActualFiles: (id: string, files: readonly string[]) => Effect.Effect<Record | undefined>
  readonly config: () => Effect.Effect<Config>
  readonly setConcurrency: (backgroundConcurrency: number) => Effect.Effect<Config>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ActorDispatch") {}

export const layer: Layer.Layer<Service, never, never> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const recover = Effect.sync(() => {
      const now = Date.now()
      Database.transaction((db) => {
        db
          .update(ActorDispatchTable)
          .set({
            status: "interrupted",
            error: "Interrupted because the application restarted",
            manual_resume: true,
            time_updated: now,
          })
          .where(eq(ActorDispatchTable.status, "running"))
          .run()
        db
          .update(ActorDispatchTable)
          .set({ manual_resume: true, time_updated: now })
          .where(eq(ActorDispatchTable.status, "queued"))
          .run()
      })
    })

    const get = Effect.fn("ActorDispatch.get")(function* (id: string) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, id)).get()),
      )
      return row ? fromRow(row) : undefined
    })

    const getForSession = Effect.fn("ActorDispatch.getForSession")(function* (sessionID: SessionID, id: string) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(ActorDispatchTable)
            .where(and(eq(ActorDispatchTable.id, id), eq(ActorDispatchTable.session_id, sessionID)))
            .get(),
        ),
      )
      return row ? fromRow(row) : undefined
    })

    const list = Effect.fn("ActorDispatch.list")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(ActorDispatchTable)
            .where(eq(ActorDispatchTable.session_id, sessionID))
            .orderBy(desc(ActorDispatchTable.time_created), desc(ActorDispatchTable.id))
            .all(),
        ),
      )
      return rows.map((row) => fromRow(row, rows))
    })

    const enqueue = Effect.fn("ActorDispatch.enqueue")(function* (input: {
      sessionID: SessionID
      actorID: string
      parentActorID?: string
      agent: string
      description: string
      context: z.infer<typeof ContextMode>
      model?: z.infer<typeof Model>
      contextRefs?: readonly string[]
      declaredFiles?: readonly string[]
      writeAccess: boolean
      payload: Payload
      resumedFrom?: string
      attempt?: number
    }) {
      const id = ulid()
      const now = Date.now()
      const contextRefs = normalized(input.contextRefs)
      const declaredFiles = normalized(input.declaredFiles)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(ActorDispatchTable)
            .values({
              id,
              session_id: input.sessionID,
              actor_id: input.actorID,
              parent_actor_id: input.parentActorID ?? null,
              agent: input.agent,
              description: input.description,
              status: "queued",
              execution: "background",
              context_mode: input.context,
              model: input.model ?? null,
              payload: { ...input.payload, contextRefs, declaredFiles },
              context_refs: contextRefs,
              declared_files: declaredFiles,
              actual_files: [],
              write_access: input.writeAccess,
              result: null,
              error: null,
              unread: false,
              acknowledged_at: null,
              manual_resume: false,
              resumed_from: input.resumedFrom ?? null,
              attempt: input.attempt ?? (input.resumedFrom ? 2 : 1),
              time_started: null,
              time_completed: null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        ),
      )
      const row = yield* get(id)
      if (!row) return yield* Effect.die(new Error(`Actor dispatch ${id} missing after enqueue`))
      return row
    })

    const claimNext = Effect.fn("ActorDispatch.claimNext")(function* (sessionID: SessionID) {
      const claimed = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const concurrency =
            db
              .select()
              .from(ActorDispatchSettingsTable)
              .where(eq(ActorDispatchSettingsTable.id, SETTINGS_ID))
              .get()?.background_concurrency ?? DEFAULT_BACKGROUND_CONCURRENCY
          const running = db
            .select()
            .from(ActorDispatchTable)
            .where(and(eq(ActorDispatchTable.session_id, sessionID), eq(ActorDispatchTable.status, "running")))
            .all().length
          if (running >= concurrency) return
          const queued = db
            .select()
            .from(ActorDispatchTable)
            .where(
              and(
                eq(ActorDispatchTable.session_id, sessionID),
                eq(ActorDispatchTable.status, "queued"),
                eq(ActorDispatchTable.manual_resume, false),
              ),
            )
            .orderBy(asc(ActorDispatchTable.time_created), asc(ActorDispatchTable.id))
            .all()
          const runningRows = db
            .select()
            .from(ActorDispatchTable)
            .where(and(eq(ActorDispatchTable.session_id, sessionID), eq(ActorDispatchTable.status, "running")))
            .all()
          const next = queued.find((candidate) => {
            if (!candidate.write_access) return true
            const files = new Set(knownFiles(candidate))
            if (files.size === 0) return true
            return !runningRows.some(
              (running) =>
                running.write_access && knownFiles(running).some((file) => files.has(file)),
            )
          })
          if (!next) return
          const now = Date.now()
          const payload = Payload.parse(next.payload)
          db
            .update(ActorDispatchTable)
            .set({
              status: "running",
              payload: researchPayload(payload, { phase: "retrieving", startedAt: now }),
              time_started: now,
              time_updated: now,
            })
            .where(and(eq(ActorDispatchTable.id, next.id), eq(ActorDispatchTable.status, "queued")))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, next.id)).get()
        }),
      )
      return claimed ? fromRow(claimed) : undefined
    })

    const complete = Effect.fn("ActorDispatch.complete")(function* (input: {
      id: string
      status: "completed" | "failed" | "cancelled"
      subtaskCount?: number
      result?: string
      error?: string
    }) {
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const now = Date.now()
          const current = db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, input.id)).get()
          if (!current) return
          const payload = Payload.parse(current.payload)
          db
            .update(ActorDispatchTable)
            .set({
              status: input.status,
              payload: researchPayload(payload, {
                phase: input.status,
                ...(input.subtaskCount !== undefined ? { subtaskCount: input.subtaskCount } : {}),
                completedAt: now,
                ...(input.result ? { result: input.result } : {}),
              }),
              result: input.result ?? null,
              error: input.error ?? null,
              unread: input.status !== "cancelled",
              time_completed: now,
              time_updated: now,
            })
            .where(and(eq(ActorDispatchTable.id, input.id), eq(ActorDispatchTable.status, "running")))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, input.id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const updateResearch = Effect.fn("ActorDispatch.updateResearch")(function* (input: {
      id: string
      phase: z.infer<typeof ResearchDispatchSnapshot>["phase"]
      subtaskCount?: number
    }) {
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const now = Date.now()
          const current = db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, input.id)).get()
          if (!current || current.status !== "running") return current
          const payload = Payload.parse(current.payload)
          if (!payload.research) return current
          db
            .update(ActorDispatchTable)
            .set({
              payload: researchPayload(payload, {
                phase: input.phase,
                ...(input.subtaskCount !== undefined ? { subtaskCount: input.subtaskCount } : {}),
              }),
              time_updated: now,
            })
            .where(and(eq(ActorDispatchTable.id, input.id), eq(ActorDispatchTable.status, "running")))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, input.id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const cancel = Effect.fn("ActorDispatch.cancel")(function* (input: {
      sessionID: SessionID
      actorID?: string
      id?: string
      reason?: string
    }) {
      if (!input.actorID && !input.id) return
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const current = input.id
            ? db
                .select()
                .from(ActorDispatchTable)
                .where(and(eq(ActorDispatchTable.id, input.id), eq(ActorDispatchTable.session_id, input.sessionID)))
                .get()
            : db
                .select()
                .from(ActorDispatchTable)
                .where(
                  and(
                    eq(ActorDispatchTable.session_id, input.sessionID),
                    eq(ActorDispatchTable.actor_id, input.actorID!),
                    inArray(ActorDispatchTable.status, ["queued", "running", "interrupted"]),
                  ),
                )
                .orderBy(desc(ActorDispatchTable.time_created))
                .get()
          if (!current || TERMINAL.has(current.status)) return current
          const now = Date.now()
          const payload = Payload.parse(current.payload)
          db
            .update(ActorDispatchTable)
            .set({
              status: "cancelled",
              payload: researchPayload(payload, { phase: "cancelled", completedAt: now }),
              error: input.reason ?? "Cancelled",
              unread: false,
              manual_resume: false,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(ActorDispatchTable.id, current.id))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, current.id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const receive = Effect.fn("ActorDispatch.receive")(function* (sessionID: SessionID, id: string) {
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const current = db
            .select()
            .from(ActorDispatchTable)
            .where(and(eq(ActorDispatchTable.id, id), eq(ActorDispatchTable.session_id, sessionID)))
            .get()
          if (!current) return
          const now = Date.now()
          db
            .update(ActorDispatchTable)
            .set({ unread: false, acknowledged_at: now, time_updated: now })
            .where(eq(ActorDispatchTable.id, id))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const resume = Effect.fn("ActorDispatch.resume")(function* (sessionID: SessionID, id: string) {
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const current = db
            .select()
            .from(ActorDispatchTable)
            .where(and(eq(ActorDispatchTable.id, id), eq(ActorDispatchTable.session_id, sessionID)))
            .get()
          if (
            !current ||
            !current.manual_resume ||
            (current.status !== "queued" && current.status !== "interrupted")
          ) {
            return current
          }
          const now = Date.now()
          db
            .update(ActorDispatchTable)
            .set({
              status: "cancelled",
              error: "Superseded by a manually resumed attempt",
              manual_resume: false,
              unread: false,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(ActorDispatchTable.id, id))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const recordActualFiles = Effect.fn("ActorDispatch.recordActualFiles")(function* (id: string, files: readonly string[]) {
      const row = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const current = db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, id)).get()
          if (!current) return
          const actualFiles = normalized([...(current.actual_files ?? []), ...files])
          db
            .update(ActorDispatchTable)
            .set({ actual_files: actualFiles, time_updated: Date.now() })
            .where(eq(ActorDispatchTable.id, id))
            .run()
          return db.select().from(ActorDispatchTable).where(eq(ActorDispatchTable.id, id)).get()
        }),
      )
      return row ? fromRow(row) : undefined
    })

    const config = Effect.fn("ActorDispatch.config")(function* () {
      return yield* Effect.sync(readConfig)
    })

    const setConcurrency = Effect.fn("ActorDispatch.setConcurrency")(function* (backgroundConcurrency: number) {
      const next = Config.parse({ backgroundConcurrency })
      yield* Effect.sync(() => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(ActorDispatchSettingsTable)
            .values({
              id: SETTINGS_ID,
              background_concurrency: next.backgroundConcurrency,
              time_created: now,
              time_updated: now,
            })
            .onConflictDoUpdate({
              target: ActorDispatchSettingsTable.id,
              set: { background_concurrency: next.backgroundConcurrency, time_updated: now },
            })
            .run(),
        )
      })
      return next
    })

    yield* recover
    const impl = Service.of({
      enqueue,
      claimNext,
      complete,
      updateResearch,
      cancel,
      get,
      getForSession,
      list,
      receive,
      resume,
      recordActualFiles,
      config,
      setConcurrency,
    })
    dispatchRef.current = impl
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (dispatchRef.current === impl) dispatchRef.current = undefined
      }),
    )
    return impl
  }),
)

export const defaultLayer = Layer.suspend(() => layer)

export * as ActorDispatch from "./dispatch"
