import { EffectLogger, InstanceState } from "@/effect"
import { Runner } from "@/effect"
import { Effect, Exit, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"
import { SessionStatus } from "./status"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancelActor: (sessionID: SessionID, agentID: string) => Effect.Effect<void>
  readonly noteSteer: (sessionID: SessionID, messageID: MessageID) => Effect.Effect<void>
  readonly takePendingSteer: (sessionID: SessionID) => Effect.Effect<MessageID[]>
  readonly hasPendingSteer: (sessionID: SessionID) => Effect.Effect<boolean>
  readonly ensureRunning: (
    sessionID: SessionID,
    agentID: string,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionRunState") {}

const runnerKey = (sessionID: SessionID, agentID: string) => `${sessionID}:${agentID}`

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
        const next = yield* settledStatus(sessionID).pipe(Effect.orElseSucceed(() => ({ type: "idle" as const })))
        yield* status.set(sessionID, next)
        yield* elog.debug("session_status_settled", { sessionID, status: next })
      })

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<string, Runner.Runner<MessageV2.WithParts>>()
        const pendingSteer = new Map<SessionID, Set<MessageID>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            const mainSessionIDs = [...runners.keys()]
              .filter((key) => key.endsWith(":main"))
              .map((key) => SessionID.make(key.slice(0, -":main".length)))
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
            pendingSteer.clear()
            yield* Effect.forEach(mainSessionIDs, restoreSettledStatus, {
              concurrency: "unbounded",
              discard: true,
            })
          }),
        )
        return { runners, pendingSteer, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const key = runnerKey(sessionID, agentID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (existing) return existing
      const isMain = agentID === "main"
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        label: key,
        onReentryWarn: (info) => elog.warn("runner-reentry", info),
        onIdle: isMain
          ? Effect.gen(function* () {
              if (data.runners.get(key) === next) {
                data.runners.delete(key)
              }
              yield* restoreSettledStatus(sessionID)
            })
          : Effect.sync(() => {
              if (data.runners.get(key) === next) {
                data.runners.delete(key)
              }
            }),
        onBusy: isMain ? status.set(sessionID, { type: "busy" }) : Effect.void,
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(key, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(runnerKey(sessionID, "main"))
      if (existing?.busy) throw new Session.BusyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const key = runnerKey(sessionID, "main")
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      yield* elog.info("session_abort_requested", { sessionID, busy: !!existing?.busy })
      if (!existing || !existing.busy) {
        const info = yield* session.get(sessionID)
        if (info.interaction?.mode === "interactive-html") {
          yield* session.setInteraction({ sessionID, interaction: undefined })
        }
        yield* status.set(sessionID, { type: "idle" })
        yield* elog.info("session_abort_completed", { sessionID, busy: false, forced: false })
        return
      }
      const cancelled = yield* existing.cancel.pipe(Effect.timeout("2 seconds"), Effect.exit)
      if (Exit.isSuccess(cancelled)) {
        yield* elog.info("session_abort_completed", { sessionID, busy: true, forced: false })
        return
      }
      yield* elog.warn("cancel-timeout", { sessionID })
      if (data.runners.get(key) === existing) {
        data.runners.delete(key)
      }
      data.pendingSteer.delete(sessionID)
      yield* restoreSettledStatus(sessionID)
      yield* elog.info("session_abort_completed", { sessionID, busy: true, forced: true })
    })

    const cancelActor = Effect.fn("SessionRunState.cancelActor")(function* (
      sessionID: SessionID,
      agentID: string,
    ) {
      const key = runnerKey(sessionID, agentID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (!existing || !existing.busy) return
      const cancelled = yield* existing.cancel.pipe(Effect.timeout("2 seconds"), Effect.exit)
      if (Exit.isSuccess(cancelled)) return
      yield* elog.warn("cancel-actor-timeout", { sessionID, agentID })
      if (data.runners.get(key) === existing) {
        data.runners.delete(key)
      }
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
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, agentID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, "main", onInterrupt)).startShell(work)
    })

    return Service.of({ assertNotBusy, cancel, cancelActor, noteSteer, takePendingSteer, hasPendingSteer, ensureRunning, startShell })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer), Layer.provide(Session.defaultLayer))

export * as SessionRunState from "./run-state"
