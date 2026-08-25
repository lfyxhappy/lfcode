import { Context, Effect, Layer, Scope, Schema } from "effect"
import { ulid } from "ulid"
import { Database, eq, and, lte, inArray } from "@/storage"
import { Bus } from "@/bus"
import { ActorRegistry } from "@/actor/registry"
import { Session } from "@/session"
import { MessageID, PartID } from "@/session/schema"
import { InboxArrived } from "@/actor/events"
import { runTurn } from "@/actor/turn"
import type { SessionID } from "@/session/schema"
import { Log } from "@/util"
import { InboxTable } from "./inbox.sql"
import { renderInboxRow } from "./render"
import { sessionPromptRef, inboxServiceRef } from "./inbox-ref"

const log = Log.create({ service: "inbox" })

const GC_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_DRAIN_PER_TURN = 100
export const MAX_CONSECUTIVE_COMPLETION_WAKES = 3

export type CompletionNotification = {
  source: "actor" | "shell-job" | "task"
  id: string
  status: "completed" | "failed" | "cancelled"
  summary: string
  finishedAt: number
  collectAction: string
  dedupeKey: string
}

/** Delete inbox rows whose created_at is at or before cutoffMs. Unit-testable without layer reset. */
export function gcInboxRows(cutoffMs: number) {
  return Effect.sync(() =>
    Database.use((db) => db.delete(InboxTable).where(lte(InboxTable.created_at, cutoffMs)).run()),
  )
}

export class InboxReceiverNotFound extends Schema.TaggedErrorClass<InboxReceiverNotFound>()(
  "InboxReceiverNotFound",
  {
    receiverSessionID: Schema.String,
    receiverActorID: Schema.String,
  },
) {}

export interface SendInput {
  receiverSessionID: SessionID
  receiverActorID: string
  senderSessionID?: SessionID
  senderActorID?: string
  content: string
  type?: string
  /** Persist and publish the notification without scheduling a model turn. */
  wake?: boolean
}

export interface SendResult {
  inboxID: string
  /** Whether this delivery scheduled a receiver turn. */
  wakeScheduled?: boolean
}

export interface Interface {
  readonly send: (input: SendInput) => Effect.Effect<SendResult, InboxReceiverNotFound>
  readonly sendCompletion?: (input: {
    receiverSessionID: SessionID
    receiverActorID: string
    senderSessionID?: SessionID
    senderActorID?: string
    notification: CompletionNotification
  }) => Effect.Effect<SendResult, InboxReceiverNotFound>
  /** A real user prompt makes this owner eligible for another bounded idle wake sequence. */
  readonly resetCompletionWakeBudget?: (input: { sessionID: SessionID; actorID: string }) => Effect.Effect<void>
  readonly drain: (sessionID: SessionID, actorID: string) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Inbox") {}

export const layer: Layer.Layer<
  Service,
  never,
  Bus.Service | ActorRegistry.Service | Session.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const reg = yield* ActorRegistry.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const completionWakeCount = new Map<string, number>()

    // 7-day GC at init. Idempotent: deletes any rows older than now-7d.
    yield* gcInboxRows(Date.now() - GC_TTL_MS)
    log.info("inbox gc-on-init complete")

    const send = Effect.fn("Inbox.send")(function* (input: SendInput) {
      // ESRCH check (B3). receiver row must exist.
      const receiver = yield* reg.get(input.receiverSessionID, input.receiverActorID)
      if (!receiver) {
        return yield* Effect.fail(
          new InboxReceiverNotFound({
            receiverSessionID: input.receiverSessionID,
            receiverActorID: input.receiverActorID,
          }),
        )
      }

      const row = {
        id: ulid(),
        receiver_session_id: input.receiverSessionID,
        receiver_actor_id: input.receiverActorID,
        sender_session_id: input.senderSessionID ?? null,
        sender_actor_id: input.senderActorID ?? null,
        type: input.type ?? "text",
        content: { text: input.content },
        created_at: Date.now(),
      }
      yield* Effect.sync(() => Database.use((db) => db.insert(InboxTable).values(row).run()))
      yield* bus.publish(InboxArrived, {
        receiverSessionID: input.receiverSessionID,
        receiverActorID: input.receiverActorID,
        ...(input.senderSessionID !== undefined ? { senderSessionID: input.senderSessionID } : {}),
        ...(input.senderActorID !== undefined ? { senderActorID: input.senderActorID } : {}),
        inboxID: row.id,
        type: row.type,
      })

      // Fork-and-forget wake (B2). Sender returns after fork is scheduled;
      // wake fiber lives in the service scope, so sender lifecycle does
      // not affect delivery.
      if (input.wake === false) return { inboxID: row.id, wakeScheduled: false }

      const promptRef = sessionPromptRef.current
      if (promptRef) {
        const wake = promptRef.loop({ sessionID: input.receiverSessionID, agentID: input.receiverActorID })
        yield* (receiver.status === "idle"
          ? wake.pipe(
              (work) => runTurn(input.receiverSessionID, input.receiverActorID, work),
              Effect.provideService(ActorRegistry.Service, reg),
            )
          : wake
        ).pipe(Effect.ignore, Effect.forkIn(scope))
      } else {
        // Test fixtures / renderer-only paths can run without SessionPrompt.
        // Row is durable; will be drained on next runLoop iteration.
        log.warn("inbox.send: sessionPromptRef.current undefined — wake skipped", {
          receiverActorID: input.receiverActorID,
        })
      }

      return { inboxID: row.id, wakeScheduled: true }
    })

    const sendCompletion = Effect.fn("Inbox.sendCompletion")(function* (input: {
      receiverSessionID: SessionID
      receiverActorID: string
      senderSessionID?: SessionID
      senderActorID?: string
      notification: CompletionNotification
    }) {
      const receiver = yield* reg.get(input.receiverSessionID, input.receiverActorID)
      if (!receiver) {
        return yield* Effect.fail(
          new InboxReceiverNotFound({
            receiverSessionID: input.receiverSessionID,
            receiverActorID: input.receiverActorID,
          }),
        )
      }
      const pending = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({ id: InboxTable.id, content: InboxTable.content })
            .from(InboxTable)
            .where(
              and(
                eq(InboxTable.receiver_session_id, input.receiverSessionID),
                eq(InboxTable.receiver_actor_id, input.receiverActorID),
                eq(InboxTable.type, "completion_notification"),
              ),
            )
            .all(),
        ),
      )
      const duplicate = pending.find((item) => completionNotification(item.content)?.dedupeKey === input.notification.dedupeKey)
      if (duplicate) return { inboxID: duplicate.id, wakeScheduled: false }
      const wakeKey = `${input.receiverSessionID}\0${input.receiverActorID}`
      const idleWake = receiver.status === "idle"
      const wakes = completionWakeCount.get(wakeKey) ?? 0
      const wake = !idleWake || wakes < MAX_CONSECUTIVE_COMPLETION_WAKES
      if (idleWake && wake) completionWakeCount.set(wakeKey, wakes + 1)
      return yield* send({
        receiverSessionID: input.receiverSessionID,
        receiverActorID: input.receiverActorID,
        ...(input.senderSessionID ? { senderSessionID: input.senderSessionID } : {}),
        ...(input.senderActorID ? { senderActorID: input.senderActorID } : {}),
        type: "completion_notification",
        content: JSON.stringify(input.notification),
        wake,
      })
    })

    const resetCompletionWakeBudget = Effect.fn("Inbox.resetCompletionWakeBudget")(function* (input: {
      sessionID: SessionID
      actorID: string
    }) {
      completionWakeCount.delete(`${input.sessionID}\0${input.actorID}`)
    })

    const drain = Effect.fn("Inbox.drain")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      // Cheap indexed SELECT first — if inbox is empty, bail immediately.
      // Common case: every iteration discovers nothing to drain.
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(InboxTable)
            .where(
              and(
                eq(InboxTable.receiver_session_id, sessionID),
                eq(InboxTable.receiver_actor_id, actorID),
              ),
            )
            .orderBy(InboxTable.id)
            .limit(MAX_DRAIN_PER_TURN)
            .all(),
        ),
      )
      if (rows.length === 0) return 0

      // Find the most recent real (non-system) assistant in this slice so the
      // synthetic user message inherits its agent + model. Pulled into Inbox
      // module so plan 3 can delete actor/completion.ts wholesale.
      const sliceMessages = yield* sessions.messages({ sessionID, agentID: actorID })
      const lastReal = sliceMessages.findLast(
        (m) =>
          (m.info.role === "user" || m.info.role === "assistant") &&
          "model" in m.info &&
          m.info.model !== undefined &&
          m.info.model.providerID !== "system" &&
          m.info.agent !== "system",
      )
      if (
        !lastReal ||
        !("model" in lastReal.info) ||
        !lastReal.info.model ||
        !("agent" in lastReal.info)
      ) {
        // Slice has no real assistant yet — defer the drain. Rows stay in the
        // inbox; next iteration after a real turn will pick them up.
        return 0
      }

      // Non-transactional crash window: updateMessage + updatePart commit
      // before the inbox DELETE. A crash between them re-renders the same
      // rows on next drain — LLM sees duplicated notifications. Tolerable;
      // a transactional fix would require threading tx through
      // sessions.updateMessage/updatePart, which crosses three abstraction
      // layers.
      const msgID = MessageID.ascending()
      const now = Date.now()
      yield* sessions.updateMessage({
        id: msgID,
        role: "user" as const,
        sessionID,
        agentID: actorID,
        time: { created: now },
        agent: lastReal.info.agent,
        model: lastReal.info.model,
      })
      for (const row of rows) {
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: msgID,
          sessionID,
          type: "text" as const,
          synthetic: row.type !== "actor_followup",
          text: renderInboxRow(row),
        })
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .delete(InboxTable)
            .where(inArray(InboxTable.id, rows.map((r) => r.id)))
            .run(),
        ),
      )

      return rows.length
    })

    const impl = Service.of({ send, sendCompletion, resetCompletionWakeBudget, drain })
    inboxServiceRef.current = impl
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (inboxServiceRef.current === impl) inboxServiceRef.current = undefined
      }),
    )
    return impl
  }),
)

function completionNotification(content: unknown): CompletionNotification | undefined {
  if (!content || typeof content !== "object" || !("text" in content) || typeof content.text !== "string") return
  try {
    const parsed = JSON.parse(content.text) as Partial<CompletionNotification>
    return typeof parsed.dedupeKey === "string" ? (parsed as CompletionNotification) : undefined
  } catch {
    return
  }
}

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
  Layer.provide(ActorRegistry.defaultLayer),
  Layer.provide(Session.defaultLayer),
)
