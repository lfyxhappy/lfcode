import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Log } from "../util"
import { SessionID } from "./schema"
import { Database, eq } from "@/storage"
import { SessionTable } from "./session.sql"
import { Cause, Effect, Layer, Context } from "effect"
import z from "zod"

const log = Log.create({ service: "session.status" })

export const Info = z
  .union([
    z.object({
      type: z.literal("idle"),
    }),
    z.object({
      type: z.literal("retry"),
      attempt: z.number(),
      message: z.string(),
      next: z.number(),
    }),
    z.object({
      type: z.literal("busy"),
      message: z.string().optional(),
    }),
    z.object({
      type: z.literal("waiting"),
      mode: z.literal("interactive-html"),
      message: z.string().optional(),
    }),
    z.object({
      type: z.literal("recoverable"),
      message: z.string(),
      reason: z.string().optional(),
      at: z.number().int().nonnegative(),
    }),
  ])
  .meta({
    ref: "SessionStatus",
  })
export type Info = z.infer<typeof Info>

export const Event = {
  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: SessionID.zod,
      status: Info,
    }),
  ),
  // deprecated
  Idle: BusEvent.define(
    "session.idle",
    z.object({
      sessionID: SessionID.zod,
    }),
  ),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    const bestEffort = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, fallback: A): Effect.Effect<A, never, R> =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) return Effect.interrupt
          return Effect.sync(() => {
            log.warn("status side effect failed; continuing", { label, error: String(cause) })
            return fallback
          })
        }),
      )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const active = data.get(sessionID)
      if (active) return active
      const persisted = yield* bestEffort(
        "read",
        Effect.try({
          try: () =>
            Database.use((db) =>
              db
                .select({
                  recoverable: SessionTable.recoverable,
                  reason: SessionTable.recoverable_reason,
                  updated: SessionTable.time_updated,
                })
                .from(SessionTable)
                .where(eq(SessionTable.id, sessionID))
                .get(),
            ),
          catch: (error) => error,
        }),
        undefined,
      )
      if (persisted?.recoverable === 1) {
        return {
          type: "recoverable" as const,
          message: persisted.reason ?? "The session can be resumed.",
          reason: persisted.reason ?? undefined,
          at: persisted.updated,
        }
      }
      return { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const output = new Map(yield* InstanceState.get(state))
      const persisted = yield* bestEffort(
        "list",
        Effect.try({
          try: () =>
            Database.use((db) =>
              db
                .select({ id: SessionTable.id, reason: SessionTable.recoverable_reason, updated: SessionTable.time_updated })
                .from(SessionTable)
                .where(eq(SessionTable.recoverable, 1))
                .all(),
            ),
          catch: (error) => error,
        }),
        [] as Array<{ id: SessionID; reason: string | null; updated: number }>,
      )
      for (const row of persisted) {
        if (output.has(row.id)) continue
        output.set(row.id, {
          type: "recoverable",
          message: row.reason ?? "The session can be resumed.",
          reason: row.reason ?? undefined,
          at: row.updated,
        })
      }
      return output
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      if (status.type === "idle") {
        data.delete(sessionID)
      } else {
        data.set(sessionID, status)
      }
      yield* bestEffort(
        "persist",
        Effect.try({
          try: () =>
            Database.use((db) =>
              db
                .update(SessionTable)
                .set({
                  recoverable: status.type === "recoverable" ? 1 : 0,
                  recoverable_reason: status.type === "recoverable" ? status.reason ?? status.message : null,
                })
                .where(eq(SessionTable.id, sessionID))
                .run(),
            ),
          catch: (error) => error,
        }),
        undefined,
      )
      yield* bestEffort("status-event", bus.publish(Event.Status, { sessionID, status }), undefined)
      if (status.type === "idle") {
        yield* bestEffort("idle-event", bus.publish(Event.Idle, { sessionID }), undefined)
      }
    })

    return Service.of({ get, list, set })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as SessionStatus from "./status"
