import { EffectLogger, InstanceState } from "@/effect"
import { Runner } from "@/effect"
import { Context, Deferred, Effect, Layer, Scope } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"
import { SessionStatus } from "./status"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * Marks an async prompt as active before its detached request starts. The
   * returned signal is passed into that prompt so a Stop between HTTP 204 and
   * runner creation cannot start a late model request.
   */
  readonly reserveAsync: (sessionID: SessionID) => Effect.Effect<AbortSignal>
  readonly releaseAsync: (sessionID: SessionID, signal: AbortSignal) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancelAll: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancelActor: (sessionID: SessionID, agentID: string) => Effect.Effect<void>
  readonly noteSteer: (sessionID: SessionID, messageID: MessageID) => Effect.Effect<void>
  readonly takePendingSteer: (sessionID: SessionID) => Effect.Effect<MessageID[]>
  readonly hasPendingSteer: (sessionID: SessionID) => Effect.Effect<boolean>
  readonly ensureRunning: (
    sessionID: SessionID,
    agentID: string,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work:
      | Effect.Effect<MessageV2.WithParts>
      | ((abortSignal: AbortSignal) => Effect.Effect<MessageV2.WithParts>),
    abortSignal?: AbortSignal,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionRunState") {}

const runnerKey = (sessionID: SessionID, agentID: string) => `${sessionID}:${agentID}`

type ActiveRunner = {
  runner: Runner.Runner<MessageV2.WithParts>
  abortController: AbortController
}

type AsyncReservation = {
  abortController: AbortController
}

const CANCEL_SETTLE_TIMEOUT = "2 seconds"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const elog = EffectLogger.create({ service: "SessionRunState" })

    const settledStatus = (sessionID: SessionID) =>
      Effect.gen(function* () {
      const info = yield* session.get(sessionID)
      if (info.interaction?.mode === "interactive-html") {
        return {
          type: "waiting" as const,
          mode: "interactive-html" as const,
          message: info.interaction.message,
        }
      }
      return { type: "idle" as const }
      })
    const restoreSettledStatus = (sessionID: SessionID) =>
      Effect.gen(function* () {
        const current = yield* status.get(sessionID)
        if (current.type === "recoverable") {
          yield* elog.debug("session_status_preserved", { sessionID, status: current })
          return
        }
        const next = yield* settledStatus(sessionID).pipe(Effect.orElseSucceed(() => ({ type: "idle" as const })))
        yield* status.set(sessionID, next)
        yield* elog.debug("session_status_settled", { sessionID, status: next })
      })

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<string, ActiveRunner>()
        const reservations = new Map<string, AsyncReservation>()
        const settling = new Map<string, Deferred.Deferred<void>>()
        const pendingSteer = new Map<SessionID, Set<MessageID>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            const mainSessionIDs = [...runners.keys()]
              .filter((key) => key.endsWith(":main"))
              .map((key) => SessionID.make(key.slice(0, -":main".length)))
            yield* Effect.forEach(
              runners.values(),
              (entry) =>
                Effect.gen(function* () {
                  entry.abortController.abort()
                  yield* entry.runner.cancel
                }),
              {
                concurrency: "unbounded",
                discard: true,
              },
            )
            runners.clear()
            reservations.clear()
            settling.clear()
            pendingSteer.clear()
            yield* Effect.forEach(mainSessionIDs, restoreSettledStatus, {
              concurrency: "unbounded",
              discard: true,
            })
          }),
        )
        return { runners, reservations, settling, pendingSteer, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      requestedAbortSignal?: AbortSignal,
    ) {
      const key = runnerKey(sessionID, agentID)
      let data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (existing) return existing
      if (requestedAbortSignal?.aborted) return

      const pendingCancellation = data.settling.get(key)
      if (pendingCancellation) {
        const settled = yield* Deferred.await(pendingCancellation).pipe(
          Effect.timeout(CANCEL_SETTLE_TIMEOUT),
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
        if (!settled) {
          yield* elog.warn("cancel-settle-timeout", { sessionID, agentID, timeout: CANCEL_SETTLE_TIMEOUT })
        }
        data = yield* InstanceState.get(state)
        const replacement = data.runners.get(key)
        if (replacement) return replacement
        if (data.settling.get(key) === pendingCancellation) data.settling.delete(key)
      }

      const reservation = data.reservations.get(key)
      if (reservation && reservation.abortController.signal !== requestedAbortSignal) {
        throw new Session.BusyError(sessionID)
      }
      const isMain = agentID === "main"
      const abortController = reservation?.abortController ?? new AbortController()
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        label: key,
        onReentryWarn: (info) => elog.warn("runner-reentry", info),
        onIdle: isMain
          ? Effect.gen(function* () {
              if (data.runners.get(key)?.runner !== next) return
              data.runners.delete(key)
              yield* restoreSettledStatus(sessionID)
            })
          : Effect.sync(() => {
              if (data.runners.get(key)?.runner === next) {
                data.runners.delete(key)
              }
            }),
        onBusy: isMain ? status.set(sessionID, { type: "busy" }) : Effect.void,
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      const entry = { runner: next, abortController } satisfies ActiveRunner
      data.reservations.delete(key)
      data.runners.set(key, entry)
      return entry
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(runnerKey(sessionID, "main"))
      if (existing || data.reservations.has(runnerKey(sessionID, "main"))) throw new Session.BusyError(sessionID)
    })

    const reserveAsync = Effect.fn("SessionRunState.reserveAsync")(function* (sessionID: SessionID) {
      const key = runnerKey(sessionID, "main")
      const data = yield* InstanceState.get(state)
      if (data.runners.has(key) || data.reservations.has(key)) throw new Session.BusyError(sessionID)
      const abortController = new AbortController()
      data.reservations.set(key, { abortController })
      yield* status.set(sessionID, { type: "busy" })
      yield* elog.info("session_async_reserved", { sessionID })
      return abortController.signal
    })

    const releaseAsync = Effect.fn("SessionRunState.releaseAsync")(function* (sessionID: SessionID, signal: AbortSignal) {
      const key = runnerKey(sessionID, "main")
      const data = yield* InstanceState.get(state)
      const reservation = data.reservations.get(key)
      if (!reservation || reservation.abortController.signal !== signal) return
      data.reservations.delete(key)
      if (data.runners.has(key)) return
      yield* restoreSettledStatus(sessionID)
      yield* elog.debug("session_async_released", { sessionID })
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const key = runnerKey(sessionID, "main")
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      const reservation = data.reservations.get(key)
      yield* elog.info("session_abort_requested", { sessionID, busy: !!existing || !!reservation })
      data.pendingSteer.delete(sessionID)
      if (reservation) {
        reservation.abortController.abort()
        data.reservations.delete(key)
      }
      if (!existing) {
        const info = yield* session.get(sessionID)
        if (info.interaction?.mode === "interactive-html") {
          yield* session.setInteraction({ sessionID, interaction: undefined })
        }
        yield* restoreSettledStatus(sessionID)
        yield* elog.info("session_abort_completed", { sessionID, busy: false })
        return
      }
      existing.abortController.abort()
      if (data.runners.get(key) === existing) data.runners.delete(key)
      yield* restoreSettledStatus(sessionID)

      const cancellation = yield* Deferred.make<void>()
      data.settling.set(key, cancellation)
      yield* existing.runner.cancel.pipe(
        Effect.catchCause((cause) => elog.warn("cancel-background-failed", { sessionID, cause: String(cause) })),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Deferred.succeed(cancellation, undefined).pipe(Effect.ignore)
            if (data.settling.get(key) === cancellation) data.settling.delete(key)
          }),
        ),
        Effect.forkIn(data.scope),
      )
      yield* elog.info("session_abort_signalled", { sessionID, busy: true })
    })

    const cancelActor = Effect.fn("SessionRunState.cancelActor")(function* (
      sessionID: SessionID,
      agentID: string,
    ) {
      const key = runnerKey(sessionID, agentID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (!existing) return
      existing.abortController.abort()
      if (data.runners.get(key) === existing) {
        data.runners.delete(key)
      }
      if (agentID === "main") yield* restoreSettledStatus(sessionID)
      const cancellation = yield* Deferred.make<void>()
      data.settling.set(key, cancellation)
      yield* existing.runner.cancel.pipe(
        Effect.catchCause((cause) => elog.warn("cancel-actor-background-failed", { sessionID, agentID, cause: String(cause) })),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Deferred.succeed(cancellation, undefined).pipe(Effect.ignore)
            if (data.settling.get(key) === cancellation) data.settling.delete(key)
          }),
        ),
        Effect.forkIn(data.scope),
      )
    })

    const cancelAll = Effect.fn("SessionRunState.cancelAll")(function* (sessionID: SessionID) {
      yield* cancel(sessionID)
      const data = yield* InstanceState.get(state)
      const actorIDs = [...data.runners.keys()]
        .filter((key) => key.startsWith(`${sessionID}:`))
        .map((key) => key.slice(`${sessionID}:`.length))
        .filter((agentID) => agentID !== "main")
      yield* Effect.forEach(actorIDs, (agentID) => cancelActor(sessionID, agentID), {
        concurrency: "unbounded",
        discard: true,
      })
    })

    const noteSteer = Effect.fn("SessionRunState.noteSteer")(function* (sessionID: SessionID, messageID: MessageID) {
      const data = yield* InstanceState.get(state)
      const existing = data.pendingSteer.get(sessionID)
      if (existing) {
        existing.add(messageID)
        return
      }
      data.pendingSteer.set(sessionID, new Set([messageID]))
    })

    const takePendingSteer = Effect.fn("SessionRunState.takePendingSteer")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.pendingSteer.get(sessionID)
      if (!existing || existing.size === 0) return []
      data.pendingSteer.delete(sessionID)
      return [...existing]
    })

    const hasPendingSteer = Effect.fn("SessionRunState.hasPendingSteer")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return (data.pendingSteer.get(sessionID)?.size ?? 0) > 0
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work:
        | Effect.Effect<MessageV2.WithParts>
        | ((abortSignal: AbortSignal) => Effect.Effect<MessageV2.WithParts>),
      abortSignal?: AbortSignal,
    ) {
      const active = yield* runner(sessionID, agentID, onInterrupt, abortSignal)
      if (!active) return yield* onInterrupt
      const run = typeof work === "function" ? work : () => work
      return yield* active.runner.ensureRunning(
        Effect.suspend(() => {
          if (active.abortController.signal.aborted) return Effect.interrupt
          return run(active.abortController.signal)
        }),
      )
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      const active = yield* runner(sessionID, "main", onInterrupt)
      if (!active) return yield* onInterrupt
      return yield* active.runner.startShell(
        Effect.suspend(() => {
          if (active.abortController.signal.aborted) return Effect.interrupt
          return work
        }),
      )
    })

    return Service.of({
      assertNotBusy,
      reserveAsync,
      releaseAsync,
      cancel,
      cancelAll,
      cancelActor,
      noteSteer,
      takePendingSteer,
      hasPendingSteer,
      ensureRunning,
      startShell,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer), Layer.provide(Session.defaultLayer))

export * as SessionRunState from "./run-state"
