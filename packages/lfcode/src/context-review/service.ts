import { Context, Effect, Layer } from "effect"
import { and, Database, eq, gt, inArray, lt, ne } from "@/storage"
import type { MessageID, SessionID } from "@/session/schema"
import { spawnRef } from "@/actor/spawn-ref"
import { ContextReviewTable } from "./context-review.sql"
import { ContextReview, ContextReviewFindings, type ContextReview as ContextReviewRecord } from "./schema"

type Row = typeof ContextReviewTable.$inferSelect

function fromRow(row: Row): ContextReviewRecord {
  return ContextReview.parse({
    id: row.id,
    sessionID: row.session_id,
    sourceUserMessageID: row.source_user_message_id,
    ...(row.source_assistant_message_id ? { sourceAssistantMessageID: row.source_assistant_message_id } : {}),
    ...(row.consuming_user_message_id ? { consumingUserMessageID: row.consuming_user_message_id } : {}),
    ...(row.reviewer_actor_id ? { reviewerActorID: row.reviewer_actor_id } : {}),
    status: row.status,
    ...(row.findings ? { findings: row.findings } : {}),
    ...(row.error ? { error: row.error } : {}),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_completed ? { completed: row.time_completed } : {}),
      ...(row.time_consumed ? { consumed: row.time_consumed } : {}),
      ...(row.time_expired ? { expired: row.time_expired } : {}),
    },
  })
}

export interface Interface {
  /** Creates at most one review for a source user message. Repeated scheduling is idempotent. */
  readonly create: (input: {
    sessionID: SessionID
    sourceUserMessageID: MessageID
    sourceAssistantMessageID?: MessageID
  }) => Effect.Effect<ContextReviewRecord>
  readonly start: (input: { id: string; reviewerActorID: string }) => Effect.Effect<ContextReviewRecord | undefined>
  readonly complete: (input: { id: string; findings: unknown }) => Effect.Effect<ContextReviewRecord | undefined>
  readonly fail: (input: { id: string; error: string }) => Effect.Effect<ContextReviewRecord | undefined>
  /**
   * Atomically expires older reviews and consumes the completed review belonging
   * to the immediately preceding user message. A consumed review is returned
   * exactly once, so it cannot leak into a later topic.
   */
  readonly claimForNextUser: (input: {
    sessionID: SessionID
    /** The immediately preceding main-user message selected by the session runner. */
    sourceUserMessageID: MessageID
    /** The newly admitted user message that consumes the prior review. */
    consumingUserMessageID: MessageID
  }) => Effect.Effect<ContextReviewRecord | undefined>
  /** Expires one review without revoking a newer hand-off in the same session. */
  readonly expireRecord: (input: { id: string }) => Effect.Effect<void>
  readonly expire: (input: { sessionID: SessionID }) => Effect.Effect<void>
  /** Used by the global setting transition to revoke every unconsumed hand-off immediately. */
  readonly expireAll: () => Effect.Effect<void>
  readonly get: (id: string) => Effect.Effect<ContextReviewRecord | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ContextReview") {}

type ExpiredReviewer = {
  sessionID: SessionID
  actorID: string
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const TERMINAL_STATUSES = ["consumed", "expired", "failed"] as const

function cancelExpiredReviewers(reviewers: ExpiredReviewer[]) {
  return Effect.forEach(
    reviewers,
    (reviewer) => spawnRef.current?.cancel(reviewer.sessionID, reviewer.actorID, "forced") ?? Effect.void,
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.ignore)
}

function activeReviewers(rows: Row[]): ExpiredReviewer[] {
  return rows.flatMap((row) =>
    row.reviewer_actor_id && ["pending", "running"].includes(row.status)
      ? [{ sessionID: row.session_id, actorID: row.reviewer_actor_id }]
      : [],
  )
}

/**
 * A config transition can happen outside the personalization API, so expiry
 * lives next to the durable review state instead of in a single route.
 */
export function expireAllContextReviews() {
  const now = Date.now()
  return Effect.sync(() =>
    Database.use((db) => {
      const rows = db
        .select()
        .from(ContextReviewTable)
        .where(inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]))
        .all()
      db
        .update(ContextReviewTable)
        .set({ status: "expired", time_expired: now, time_updated: now })
        .where(inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]))
        .run()
      return activeReviewers(rows)
    }),
  ).pipe(Effect.flatMap(cancelExpiredReviewers))
}

export const layer: Layer.Layer<Service, never, never> = Layer.succeed(
  Service,
  Service.of({
    create: Effect.fn("ContextReview.create")(function* (input) {
      const now = Date.now()
      const created = yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            // Terminal reviews contain reviewer-generated search keys but have
            // no product value after the hand-off window has passed.
            db
              .delete(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  inArray(ContextReviewTable.status, TERMINAL_STATUSES),
                  lt(ContextReviewTable.time_updated, now - RETENTION_MS),
                ),
              )
              .run()
            const existing = db
              .select()
              .from(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  eq(ContextReviewTable.source_user_message_id, input.sourceUserMessageID),
                ),
              )
              .get()
            if (existing) return { record: fromRow(existing), expired: [] as ExpiredReviewer[] }

            // Scheduling runs detached from the main response. A delayed fiber
            // for an older turn must not replace a review already admitted for
            // a later turn, including one that has already been consumed.
            // Message IDs are ascending identifiers.
            const newer = db
              .select()
              .from(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  gt(ContextReviewTable.source_user_message_id, input.sourceUserMessageID),
                ),
              )
              .get()
            if (newer) {
              const id = crypto.randomUUID()
              db
                .insert(ContextReviewTable)
                .values({
                  id,
                  session_id: input.sessionID,
                  source_user_message_id: input.sourceUserMessageID,
                  source_assistant_message_id: input.sourceAssistantMessageID ?? null,
                  consuming_user_message_id: null,
                  reviewer_actor_id: null,
                  status: "expired",
                  findings: null,
                  error: "Superseded by a newer context-review source turn",
                  time_completed: null,
                  time_consumed: null,
                  time_expired: now,
                  time_created: now,
                  time_updated: now,
                })
                .run()
              const superseded = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, id)).get()
              if (!superseded) throw new Error(`Superseded context review ${id} was not persisted`)
              return { record: fromRow(superseded), expired: [] as ExpiredReviewer[] }
            }

            const active = db
              .select()
              .from(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
                ),
              )
              .all()
            if (active.length > 0) {
              db
                .update(ContextReviewTable)
                .set({ status: "expired", time_expired: now, time_updated: now })
                .where(
                  and(
                    eq(ContextReviewTable.session_id, input.sessionID),
                    inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
                  ),
                )
                .run()
            }

            const id = crypto.randomUUID()
            db
              .insert(ContextReviewTable)
              .values({
                id,
                session_id: input.sessionID,
                source_user_message_id: input.sourceUserMessageID,
                source_assistant_message_id: input.sourceAssistantMessageID ?? null,
                consuming_user_message_id: null,
                reviewer_actor_id: null,
                status: "pending",
                findings: null,
                error: null,
                time_completed: null,
                time_consumed: null,
                time_expired: null,
                time_created: now,
                time_updated: now,
              })
              .run()
            const created = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, id)).get()
            if (!created) throw new Error(`Context review ${id} was not persisted`)
            return { record: fromRow(created), expired: activeReviewers(active) }
          },
          { behavior: "immediate" },
        ),
      )
      yield* cancelExpiredReviewers(created.expired)
      return created.record
    }),
    start: Effect.fn("ContextReview.start")(function* (input) {
      const now = Date.now()
      return yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            db
              .update(ContextReviewTable)
              .set({
                status: "running",
                reviewer_actor_id: input.reviewerActorID,
                time_updated: now,
              })
              .where(and(eq(ContextReviewTable.id, input.id), eq(ContextReviewTable.status, "pending")))
              .run()
            const row = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, input.id)).get()
            // A duplicate delivery for the same actor is harmless, but a
            // second actor must never take ownership of an already-running
            // review. In particular, do not let a late scheduler believe it
            // started work that belongs to a different reviewer.
            return row?.status === "running" && row.reviewer_actor_id === input.reviewerActorID ? fromRow(row) : undefined
          },
          { behavior: "immediate" },
        ),
      )
    }),
    complete: Effect.fn("ContextReview.complete")(function* (input) {
      const parsed = ContextReviewFindings.safeParse(input.findings)
      const now = Date.now()
      return yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            if (!parsed.success) {
              db
                .update(ContextReviewTable)
                .set({
                  status: "failed",
                  error: "Context reviewer returned invalid structured findings",
                  time_completed: now,
                  time_updated: now,
                })
                .where(and(eq(ContextReviewTable.id, input.id), inArray(ContextReviewTable.status, ["pending", "running"])))
                .run()
              const failed = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, input.id)).get()
              return failed?.status === "failed" ? fromRow(failed) : undefined
            }
            const findings = parsed.data
            db
              .update(ContextReviewTable)
              .set({ status: "completed", findings, error: null, time_completed: now, time_updated: now })
              .where(and(eq(ContextReviewTable.id, input.id), inArray(ContextReviewTable.status, ["pending", "running"])))
              .run()
            const row = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, input.id)).get()
            return row?.status === "completed" ? fromRow(row) : undefined
          },
          { behavior: "immediate" },
        ),
      )
    }),
    fail: Effect.fn("ContextReview.fail")(function* (input) {
      const now = Date.now()
      return yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            db
              .update(ContextReviewTable)
              .set({ status: "failed", error: input.error.slice(0, 2_000), time_completed: now, time_updated: now })
              .where(and(eq(ContextReviewTable.id, input.id), inArray(ContextReviewTable.status, ["pending", "running"])))
              .run()
            const row = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, input.id)).get()
            return row?.status === "failed" ? fromRow(row) : undefined
          },
          { behavior: "immediate" },
        ),
      )
    }),
    claimForNextUser: Effect.fn("ContextReview.claimForNextUser")(function* (input) {
      // The hand-off belongs to the following real user turn. Refuse a bad
      // caller that tries to consume a review from its own source message;
      // doing so would silently turn a pending review into one that can never
      // be delivered to the actual follow-up.
      if (input.sourceUserMessageID === input.consumingUserMessageID) return undefined
      const now = Date.now()
      const claimed = yield* Effect.sync(() =>
        Database.transaction(
          (db) => {
            const outstanding = db
              .select()
              .from(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
                ),
              )
              .all()
            db
              .update(ContextReviewTable)
              .set({ status: "expired", time_expired: now, time_updated: now })
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  ne(ContextReviewTable.source_user_message_id, input.sourceUserMessageID),
                  inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
                ),
              )
              .run()

            const candidate = db
              .select()
              .from(ContextReviewTable)
              .where(
                and(
                  eq(ContextReviewTable.session_id, input.sessionID),
                  eq(ContextReviewTable.source_user_message_id, input.sourceUserMessageID),
                  eq(ContextReviewTable.status, "completed"),
                ),
              )
              .get()
            if (!candidate) {
              db
                .update(ContextReviewTable)
                .set({ status: "expired", time_expired: now, time_updated: now })
                .where(
                  and(
                    eq(ContextReviewTable.session_id, input.sessionID),
                    eq(ContextReviewTable.source_user_message_id, input.sourceUserMessageID),
                    inArray(ContextReviewTable.status, ["pending", "running", "failed"]),
                  ),
                )
                .run()
              return { record: undefined, expired: activeReviewers(outstanding) }
            }
            db
              .update(ContextReviewTable)
              .set({
                status: "consumed",
                consuming_user_message_id: input.consumingUserMessageID,
                time_consumed: now,
                time_updated: now,
              })
              .where(and(eq(ContextReviewTable.id, candidate.id), eq(ContextReviewTable.status, "completed")))
              .run()
            const consumed = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, candidate.id)).get()
            return {
              record: consumed?.status === "consumed" ? fromRow(consumed) : undefined,
              expired: activeReviewers(outstanding),
            }
          },
          { behavior: "immediate" },
        ),
      )
      yield* cancelExpiredReviewers(claimed.expired)
      return claimed.record
    }),
    expireRecord: Effect.fn("ContextReview.expireRecord")(function* (input) {
      const now = Date.now()
      const expired = yield* Effect.sync(() =>
        Database.use((db) => {
          const row = db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, input.id)).get()
          if (!row || !["pending", "running", "completed", "failed"].includes(row.status)) return [] as ExpiredReviewer[]
          db
            .update(ContextReviewTable)
            .set({ status: "expired", time_expired: now, time_updated: now })
            .where(and(eq(ContextReviewTable.id, input.id), inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"])))
            .run()
          return activeReviewers([row])
        }),
      )
      yield* cancelExpiredReviewers(expired)
    }),
    expire: Effect.fn("ContextReview.expire")(function* (input) {
      const now = Date.now()
      const expired = yield* Effect.sync(() =>
        Database.use((db) => {
          const rows = db
            .select()
            .from(ContextReviewTable)
            .where(
              and(
                eq(ContextReviewTable.session_id, input.sessionID),
                inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
              ),
            )
            .all()
          db
            .update(ContextReviewTable)
            .set({ status: "expired", time_expired: now, time_updated: now })
            .where(
              and(
                eq(ContextReviewTable.session_id, input.sessionID),
                inArray(ContextReviewTable.status, ["pending", "running", "completed", "failed"]),
              ),
            )
            .run()
          return activeReviewers(rows)
        }),
      )
      yield* cancelExpiredReviewers(expired)
    }),
    expireAll: Effect.fn("ContextReview.expireAll")(function* () {
      yield* expireAllContextReviews()
    }),
    get: Effect.fn("ContextReview.get")(function* (id) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, id)).get()),
      )
      return row ? fromRow(row) : undefined
    }),
  }),
)
