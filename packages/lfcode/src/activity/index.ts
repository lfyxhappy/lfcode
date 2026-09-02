import { Context, Effect, Layer } from "effect"
import { ulid } from "ulid"
import z from "zod"
import { and, asc, eq } from "@/storage"
import { Database } from "@/storage"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { LocalContext } from "@/util"
import { Instance } from "@/project/instance"
import {
  ActivityTable,
  type ActivityKind,
  type ActivitySourceType,
  type ActivityStatus,
} from "./activity.sql"
import type { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"

export const ActivityInfo = z.object({
  id: z.string(),
  sessionID: z.string(),
  parentActivityID: z.string().optional(),
  kind: z.enum(["main", "subagent", "checkpoint", "background"]),
  status: z.enum(["queued", "running", "waiting", "interrupted", "recoverable", "completed", "failed", "cancelled"]),
  recoverable: z.boolean(),
  currentStep: z.string().optional(),
  sourceType: z.enum(["session", "actor", "checkpoint", "background-job"]),
  sourceID: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  revision: z.number().int().nonnegative(),
  error: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})
export type Info = z.infer<typeof ActivityInfo>

export const Created = BusEvent.define("activity.created", z.object({ activity: ActivityInfo }))
export const Updated = BusEvent.define("activity.updated", z.object({ activity: ActivityInfo }))
export const Completed = BusEvent.define("activity.completed", z.object({ activity: ActivityInfo }))
export const Removed = BusEvent.define("activity.removed", z.object({ activity: ActivityInfo }))

const terminal = new Set<ActivityStatus>(["completed", "failed", "cancelled"])
const transitions: Record<Exclude<ActivityStatus, "completed" | "failed" | "cancelled">, readonly ActivityStatus[]> = {
  queued: ["queued", "running", "recoverable", "cancelled"],
  running: ["running", "waiting", "interrupted", "recoverable", "completed", "failed", "cancelled"],
  waiting: ["waiting", "running", "interrupted", "recoverable", "cancelled"],
  interrupted: ["interrupted", "running", "recoverable", "cancelled"],
  recoverable: ["recoverable", "running", "cancelled"],
}

function isMissingInstance(error: unknown): error is LocalContext.NotFound {
  return LocalContext.isNotFound(error, "instance")
}

function toInfo(row: typeof ActivityTable.$inferSelect): Info {
  return {
    id: row.id,
    sessionID: row.session_id,
    ...(row.parent_activity_id ? { parentActivityID: row.parent_activity_id } : {}),
    kind: row.kind,
    status: row.status,
    recoverable: row.status === "recoverable",
    ...(row.current_step ? { currentStep: row.current_step } : {}),
    sourceType: row.source_type,
    sourceID: row.source_id,
    metadata: row.metadata ?? {},
    revision: row.revision,
    ...(row.error ? { error: row.error } : {}),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_started !== null && row.time_started !== undefined ? { started: row.time_started } : {}),
      ...(row.time_completed !== null && row.time_completed !== undefined ? { completed: row.time_completed } : {}),
    },
  }
}

type CreateInput = {
  sessionID: SessionID
  parentActivityID?: string
  kind: ActivityKind
  status?: ActivityStatus
  currentStep?: string
  sourceType: ActivitySourceType
  sourceID: string
  metadata?: Record<string, unknown>
}

type TransitionInput = {
  id: string
  status: ActivityStatus
  expectedRevision?: number
  currentStep?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly transition: (input: TransitionInput) => Effect.Effect<Info | undefined, Error>
  readonly complete: (input: { id: string; status?: "completed" | "failed" | "cancelled"; error?: string }) => Effect.Effect<Info | undefined, Error>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined, Error>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly getBySource: (sourceType: ActivitySourceType, sourceID: string) => Effect.Effect<Info | undefined>
  readonly list: (sessionID: SessionID) => Effect.Effect<Info[]>
  readonly listDescendants: (activityID: string) => Effect.Effect<Info[]>
  readonly recoverOnStartup: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Activity") {}

export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const publish = (info: Info, created: boolean) => {
      try {
        Instance.current
      } catch (error) {
        if (isMissingInstance(error)) return Effect.void
        throw error
      }
      return bus.publish(created ? Created : terminal.has(info.status) ? Completed : Updated, { activity: info })
    }

    const create = Effect.fn("Activity.create")(function* (input: CreateInput) {
      const now = Date.now()
      const existing = Database.use((db) =>
        db.select().from(ActivityTable).where(and(eq(ActivityTable.source_type, input.sourceType), eq(ActivityTable.source_id, input.sourceID))).get(),
      )
      if (existing) return toInfo(existing)
      const id = `act_${ulid()}`
      const status = input.status ?? "queued"
      const row = Database.transaction((db) => {
        db.insert(ActivityTable).values({
          id,
          session_id: input.sessionID,
          parent_activity_id: input.parentActivityID ?? null,
          kind: input.kind,
          status,
          current_step: input.currentStep ?? null,
          source_type: input.sourceType,
          source_id: input.sourceID,
          metadata: input.metadata ?? {},
          revision: 1,
          error: null,
          time_created: now,
          time_updated: now,
          time_started: status === "running" ? now : null,
          time_completed: terminal.has(status) ? now : null,
        }).run()
        return db.select().from(ActivityTable).where(eq(ActivityTable.id, id)).get()!
      })
      const info = toInfo(row)
      yield* publish(info, true)
      return info
    })

    const transition = Effect.fn("Activity.transition")(function* (input: TransitionInput) {
      const current = Database.use((db) => db.select().from(ActivityTable).where(eq(ActivityTable.id, input.id)).get())
      if (!current) return undefined
      if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
        return yield* Effect.fail(new Error(`Activity ${input.id} revision mismatch: expected ${input.expectedRevision}, got ${current.revision}`))
      }
      if (terminal.has(current.status)) {
        if (current.status === input.status) return toInfo(current)
        return yield* Effect.fail(new Error(`Activity ${input.id} is already terminal`))
      }
      const currentStatus = current.status as Exclude<ActivityStatus, "completed" | "failed" | "cancelled">
      if (!transitions[currentStatus].includes(input.status)) {
        return yield* Effect.fail(new Error(`Activity ${input.id} cannot transition from ${current.status} to ${input.status}`))
      }
      const now = Date.now()
      const row = Database.transaction((db) => {
        const metadata = input.metadata === undefined ? current.metadata : { ...(current.metadata ?? {}), ...input.metadata }
        db.update(ActivityTable).set({
          status: input.status,
          ...(input.currentStep !== undefined ? { current_step: input.currentStep } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          ...(input.metadata !== undefined ? { metadata } : {}),
          revision: current.revision + 1,
          time_updated: now,
          ...(input.status === "running" && current.time_started == null ? { time_started: now } : {}),
          ...(terminal.has(input.status) ? { time_completed: now } : {}),
        }).where(and(eq(ActivityTable.id, input.id), eq(ActivityTable.revision, current.revision))).run()
        if (!db.select().from(ActivityTable).where(and(eq(ActivityTable.id, input.id), eq(ActivityTable.revision, current.revision + 1))).get()) return undefined
        return db.select().from(ActivityTable).where(eq(ActivityTable.id, input.id)).get()
      })
      if (!row) return undefined
      const info = toInfo(row)
      yield* publish(info, false)
      return info
    })

    const complete = (input: { id: string; status?: "completed" | "failed" | "cancelled"; error?: string }) =>
      transition({ id: input.id, status: input.status ?? "completed", error: input.error })

    const cancel = (id: string) => complete({ id, status: "cancelled" })
    const get = Effect.fn("Activity.get")(function* (id: string) {
      const row = Database.use((db) => db.select().from(ActivityTable).where(eq(ActivityTable.id, id)).get())
      return row ? toInfo(row) : undefined
    })
    const getBySource = Effect.fn("Activity.getBySource")(function* (sourceType: ActivitySourceType, sourceID: string) {
      const row = Database.use((db) =>
        db.select().from(ActivityTable).where(and(eq(ActivityTable.source_type, sourceType), eq(ActivityTable.source_id, sourceID))).get(),
      )
      return row ? toInfo(row) : undefined
    })
    const list = Effect.fn("Activity.list")(function* (sessionID: SessionID) {
      return Database.use((db) => db.select().from(ActivityTable).where(eq(ActivityTable.session_id, sessionID)).orderBy(asc(ActivityTable.time_updated)).all().map(toInfo))
    })
    const listDescendants = Effect.fn("Activity.listDescendants")(function* (activityID: string) {
      const output: Info[] = []
      const pending = [activityID]
      while (pending.length > 0) {
        const parent = pending.shift()!
        const rows = Database.use((db) => db.select().from(ActivityTable).where(eq(ActivityTable.parent_activity_id, parent)).orderBy(asc(ActivityTable.time_created)).all())
        for (const row of rows) {
          output.push(toInfo(row))
          pending.push(row.id)
        }
      }
      return output
    })

    const recoverOnStartup = Effect.fn("Activity.recoverOnStartup")(function* () {
      const rows = Database.use((db) => db.select().from(ActivityTable).all())
      const candidates = rows.filter((row) => ["queued", "running", "interrupted"].includes(row.status))
      for (const row of candidates) {
        const now = Date.now()
        const updated = Database.transaction((db) => {
          db
            .update(ActivityTable)
            .set({
              status: "recoverable",
              current_step: "recovered-after-restart",
              metadata: { ...(row.metadata ?? {}), recoveredAfterRestart: true, recoveredAt: now },
              revision: row.revision + 1,
              time_updated: now,
            })
            .where(and(eq(ActivityTable.id, row.id), eq(ActivityTable.revision, row.revision)))
            .run()
          if (row.kind === "main" && row.source_type === "session") {
            db
              .update(SessionTable)
              .set({
                recoverable: 1,
                recoverable_reason: "The session was interrupted by a process restart and can be resumed.",
              })
              .where(eq(SessionTable.id, row.session_id))
              .run()
          }
          return db.select().from(ActivityTable).where(eq(ActivityTable.id, row.id)).get()
        })
        if (updated) yield* publish(toInfo(updated), false)
      }
      return candidates.length
    })

    const service = Service.of({ create, transition, complete, cancel, get, getBySource, list, listDescendants, recoverOnStartup })
    yield* recoverOnStartup()
    return service
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer))
export * as Activity from "./index"
