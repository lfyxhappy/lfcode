import { Effect, Layer, Context, Option } from "effect"
import { generateObject, streamObject, type ModelMessage } from "ai"
import z from "zod"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { EffectLogger } from "@/effect"
import { Provider } from "@/provider"
import * as ProviderTransform from "@/provider/transform"
import type { ProviderID, ModelID } from "@/provider/schema"
import { Auth } from "@/auth"
import { Config } from "@/config"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Service, defaultLayer } from "./session"
import { GoalState, GoalStatus, GoalVerdict, Verdict } from "./goal-state"

/**
 * Session-scoped goal state. Unlike the original `/goal` stop-condition map,
 * this state is persisted on the session row so it survives instance disposal
 * and app restarts.
 */

export { GoalState, GoalStatus, GoalVerdict, Verdict }

const BLOCKED_THRESHOLD = 3

export const Event = {
  Updated: BusEvent.define(
    "session.goal",
    z.object({
      sessionID: SessionID.zod,
      goal: GoalState.optional(),
      lastVerdict: GoalVerdict.optional(),
    }),
  ),
}

const JUDGE_SYSTEM = `You are evaluating a stop-condition hook in Lfcode. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`

const judgeUser = (condition: string) =>
  `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.

Condition: ${condition}`

type CompleteResult = {
  completed: boolean
  goal?: z.infer<typeof GoalState>
  verdict?: z.infer<typeof GoalVerdict>
}

type BlockedResult = {
  blocked: boolean
  goal?: z.infer<typeof GoalState>
  remaining: number
}

type GoalStatsInput = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

export interface Interface {
  readonly create: (sessionID: SessionID, objective: string) => Effect.Effect<z.infer<typeof GoalState>>
  readonly update: (sessionID: SessionID, objective: string) => Effect.Effect<z.infer<typeof GoalState>>
  readonly set: (sessionID: SessionID, condition: string) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly getActive: (sessionID: SessionID) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly pause: (sessionID: SessionID) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly resume: (sessionID: SessionID) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly delete: (sessionID: SessionID) => Effect.Effect<void>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly bumpReact: (sessionID: SessionID) => Effect.Effect<number>
  readonly addStats: (input: {
    sessionID: SessionID
    usage: GoalStatsInput
  }) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly setVerdict: (input: {
    sessionID: SessionID
    verdict: z.infer<typeof GoalVerdict>
    status?: z.infer<typeof GoalStatus>
  }) => Effect.Effect<z.infer<typeof GoalState> | undefined>
  readonly requestBlocked: (input: {
    sessionID: SessionID
    reason: string
  }) => Effect.Effect<BlockedResult>
  readonly requestComplete: (input: {
    sessionID: SessionID
    msgs: MessageV2.WithParts[]
    model: { providerID: ProviderID; modelID: ModelID }
    messageID?: string
  }) => Effect.Effect<CompleteResult>
  readonly evaluate: (input: {
    condition: string
    msgs: MessageV2.WithParts[]
    model: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<z.infer<typeof Verdict>, unknown>
}

class GoalService extends Context.Service<GoalService, Interface>()("@lfcode/SessionGoal") {}
export { GoalService as Service }

function normalizeBlockedReason(reason: string) {
  return reason.trim().toLowerCase().replace(/\s+/g, " ")
}

function activeElapsed(goal: z.infer<typeof GoalState>, now: number) {
  if (goal.status !== "active" || !goal.stats.activeSince) return goal.stats.elapsed
  return goal.stats.elapsed + Math.max(0, now - goal.stats.activeSince)
}

function snapshot(goal: z.infer<typeof GoalState>, now: number, status: z.infer<typeof GoalStatus> = goal.status) {
  return GoalState.parse({
    ...goal,
    status,
    stats: {
      ...goal.stats,
      elapsed: activeElapsed(goal, now),
      activeSince: status === "active" ? goal.stats.activeSince ?? now : undefined,
      pausedAt: status === "paused" ? now : undefined,
    },
    time: {
      ...goal.time,
      updated: now,
    },
  })
}

function accumulateStats(goal: z.infer<typeof GoalState>, usage: GoalStatsInput, now: number) {
  const base = snapshot(goal, now)
  return GoalState.parse({
    ...base,
    stats: {
      ...base.stats,
      activeSince: goal.status === "active" ? now : base.stats.activeSince,
      tokens: {
        input: base.stats.tokens.input + Math.max(0, usage.input ?? 0),
        output: base.stats.tokens.output + Math.max(0, usage.output ?? 0),
        reasoning: base.stats.tokens.reasoning + Math.max(0, usage.reasoning ?? 0),
        cache: {
          read: base.stats.tokens.cache.read + Math.max(0, usage.cache?.read ?? 0),
          write: base.stats.tokens.cache.write + Math.max(0, usage.cache?.write ?? 0),
        },
      },
    },
  })
}

export const layer = Layer.effect(
  GoalService,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const session = yield* Service
    const elog = EffectLogger.create({ service: "SessionGoal" })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      return (yield* session.get(sessionID)).goal
    })

    const getActive = Effect.fn("SessionGoal.getActive")(function* (sessionID: SessionID) {
      const goal = yield* get(sessionID)
      if (goal?.status !== "active") return
      return goal
    })

    const publish = Effect.fn("SessionGoal.publish")(function* (
      sessionID: SessionID,
      goal?: z.infer<typeof GoalState>,
      lastVerdict?: z.infer<typeof GoalVerdict>,
    ) {
      yield* bus.publish(Event.Updated, {
        sessionID,
        goal,
        lastVerdict: lastVerdict ?? goal?.lastVerdict,
      })
    })

    const persist = Effect.fn("SessionGoal.persist")(function* (sessionID: SessionID, goal: z.infer<typeof GoalState>) {
      yield* session.setGoal({ sessionID, goal })
      yield* publish(sessionID, goal)
      return goal
    })

    const create = Effect.fn("SessionGoal.create")(function* (sessionID: SessionID, objective: string) {
      const now = Date.now()
      const goal = GoalState.parse({
        status: "active",
        objective,
        condition: objective,
        react: 0,
        blockedCount: 0,
        stats: {
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
          elapsed: 0,
          started: now,
          activeSince: now,
        },
        time: {
          created: now,
          updated: now,
        },
      })
      yield* elog.info("goal created", { sessionID, objective })
      return yield* persist(sessionID, goal)
    })

    const set = Effect.fn("SessionGoal.set")(function* (sessionID: SessionID, condition: string) {
      const current = yield* get(sessionID)
      if (!current) {
        yield* create(sessionID, condition)
        return
      }
      yield* update(sessionID, condition)
    })

    const update = Effect.fn("SessionGoal.update")(function* (sessionID: SessionID, objective: string) {
      const current = yield* get(sessionID)
      if (!current) return yield* create(sessionID, objective)
      const now = Date.now()
      const snapped = snapshot(current, now)
      const active = current.status === "active"
      const paused = current.status === "paused"
      const status = active || paused ? current.status : "active"
      const goal = GoalState.parse({
        ...snapped,
        status,
        objective,
        condition: objective,
        react: 0,
        blockedCount: 0,
        blockedReason: undefined,
        lastVerdict: undefined,
        stats: {
          ...snapped.stats,
          activeSince: status === "active" ? now : undefined,
          pausedAt: status === "paused" ? now : undefined,
        },
        time: {
          ...snapped.time,
          updated: now,
        },
      })
      yield* elog.info("goal updated", { sessionID, objective, status })
      return yield* persist(sessionID, goal)
    })

    const pause = Effect.fn("SessionGoal.pause")(function* (sessionID: SessionID) {
      const current = yield* get(sessionID)
      if (!current || current.status !== "active") return current
      const next = snapshot(current, Date.now(), "paused")
      yield* elog.info("goal paused", { sessionID })
      return yield* persist(sessionID, next)
    })

    const resume = Effect.fn("SessionGoal.resume")(function* (sessionID: SessionID) {
      const current = yield* get(sessionID)
      if (!current || current.status !== "paused") return current
      const now = Date.now()
      const next = GoalState.parse({
        ...current,
        status: "active",
        stats: {
          ...current.stats,
          activeSince: now,
          pausedAt: undefined,
        },
        time: {
          ...current.time,
          updated: now,
        },
      })
      yield* elog.info("goal resumed", { sessionID })
      return yield* persist(sessionID, next)
    })

    const deleteGoal = Effect.fn("SessionGoal.delete")(function* (sessionID: SessionID) {
      const current = yield* get(sessionID)
      if (!current) return
      yield* elog.info("goal deleted", { sessionID, status: current.status })
      yield* session.setGoal({ sessionID, goal: undefined })
      yield* publish(sessionID, undefined, current.lastVerdict)
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID) {
      const current = yield* get(sessionID)
      if (!current) return
      const goal = GoalState.parse({
        ...snapshot(current, Date.now(), "cleared"),
        react: 0,
        blockedCount: 0,
        blockedReason: undefined,
      })
      yield* elog.info("goal cleared", { sessionID })
      yield* persist(sessionID, goal)
    })

    const bumpReact = Effect.fn("SessionGoal.bumpReact")(function* (sessionID: SessionID) {
      const goal = yield* getActive(sessionID)
      if (!goal) return 0
      const next = GoalState.parse({
        ...goal,
        react: goal.react + 1,
        time: {
          ...goal.time,
          updated: Date.now(),
        },
      })
      yield* persist(sessionID, next)
      return next.react
    })

    const addStats = Effect.fn("SessionGoal.addStats")(function* (input: {
      sessionID: SessionID
      usage: GoalStatsInput
    }) {
      const goal = yield* get(input.sessionID)
      if (!goal || goal.status !== "active") return goal
      const next = accumulateStats(goal, input.usage, Date.now())
      return yield* persist(input.sessionID, next)
    })

    const setVerdict = Effect.fn("SessionGoal.setVerdict")(function* (input: {
      sessionID: SessionID
      verdict: z.infer<typeof GoalVerdict>
      status?: z.infer<typeof GoalStatus>
    }) {
      const goal = yield* get(input.sessionID)
      if (!goal) return
      const now = Date.now()
      const snapped = snapshot(goal, now, input.status ?? goal.status)
      const next = GoalState.parse({
        ...goal,
        status: snapped.status,
        lastVerdict: input.verdict,
        stats: snapped.stats,
        time: {
          ...goal.time,
          updated: now,
        },
      })
      return yield* persist(input.sessionID, next)
    })

    const requestBlocked = Effect.fn("SessionGoal.requestBlocked")(function* (input: {
      sessionID: SessionID
      reason: string
    }) {
      const goal = yield* getActive(input.sessionID)
      if (!goal) return { blocked: false, remaining: BLOCKED_THRESHOLD }
      const reason = input.reason.trim()
      const normalized = normalizeBlockedReason(reason)
      const previous = goal.blockedReason ? normalizeBlockedReason(goal.blockedReason) : undefined
      const blockedCount = previous === normalized ? goal.blockedCount + 1 : 1
      const status = blockedCount >= BLOCKED_THRESHOLD ? "blocked" : "active"
      const now = Date.now()
      const snapped = snapshot(goal, now, status)
      const next = GoalState.parse({
        ...goal,
        status: snapped.status,
        blockedCount,
        blockedReason: reason,
        lastVerdict: {
          ok: false,
          impossible: status === "blocked" ? true : undefined,
          reason,
          attempt: goal.react,
        },
        stats: snapped.stats,
        time: {
          ...goal.time,
          updated: now,
        },
      })
      yield* elog.info("goal blocked update", { sessionID: input.sessionID, blockedCount, status, reason })
      yield* persist(input.sessionID, next)
      return {
        blocked: status === "blocked",
        goal: next,
        remaining: Math.max(0, BLOCKED_THRESHOLD - blockedCount),
      }
    })

    const evaluate = Effect.fn("SessionGoal.evaluate")(function* (input: {
      condition: string
      msgs: MessageV2.WithParts[]
      model: { providerID: ProviderID; modelID: ModelID }
    }) {
      const cfg = yield* config.get()
      const resolved = yield* provider.getModel(input.model.providerID, input.model.modelID)
      const language = yield* provider.getLanguage(resolved)
      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined

      const authInfo = yield* auth.get(input.model.providerID).pipe(Effect.orDie)
      const isOpenaiOauth = input.model.providerID === "openai" && authInfo?.type === "oauth"
      const conversation = yield* MessageV2.toModelMessagesEffect(input.msgs, resolved)

      const clip = (_key: string, value: unknown) =>
        typeof value === "string" && value.length > 500
          ? `«${value.length} chars: ${value.slice(0, 200)}…»`
          : value
      const fullMessages = [
        ...(isOpenaiOauth ? [] : [{ role: "system", content: JUDGE_SYSTEM }]),
        ...conversation,
        { role: "user", content: judgeUser(input.condition) },
      ]
      yield* elog.debug("goal judge transcript", {
        condition: input.condition,
        messageCount: fullMessages.length,
        messages: JSON.stringify(fullMessages, clip),
      })

      const params = {
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          tracer,
          metadata: { userId: cfg.username ?? "unknown" },
        },
        temperature: 0,
        messages: [
          ...(isOpenaiOauth ? [] : [{ role: "system", content: JUDGE_SYSTEM } satisfies ModelMessage]),
          ...conversation,
          {
            role: "user",
            content: judgeUser(input.condition),
          } satisfies ModelMessage,
        ],
        model: language,
        schema: Verdict,
      } satisfies Parameters<typeof generateObject>[0]

      if (isOpenaiOauth) {
        return yield* Effect.promise(async () => {
          const result = streamObject({
            ...params,
            providerOptions: ProviderTransform.providerOptions(resolved, {
              instructions: JUDGE_SYSTEM,
              store: false,
            }),
            onError: () => {},
          })
          for await (const part of result.fullStream) {
            if (part.type === "error") throw part.error
          }
          return Verdict.parse(await result.object)
        })
      }

      return yield* Effect.promise(() => generateObject(params).then((r) => Verdict.parse(r.object)))
    })

    const requestComplete = Effect.fn("SessionGoal.requestComplete")(function* (input: {
      sessionID: SessionID
      msgs: MessageV2.WithParts[]
      model: { providerID: ProviderID; modelID: ModelID }
      messageID?: string
    }) {
      const goal = yield* getActive(input.sessionID)
      if (!goal) return { completed: false }

      const judged = yield* Effect.exit(
        evaluate({
          condition: goal.condition,
          msgs: input.msgs,
          model: input.model,
        }),
      )

      if (judged._tag === "Failure") {
        const verdict = GoalVerdict.parse({
          ok: true,
          reason: "judge error",
          attempt: goal.react,
          messageID: input.messageID,
          error: true,
        })
        const next = yield* setVerdict({
          sessionID: input.sessionID,
          verdict,
          status: "complete",
        })
        yield* elog.warn("goal judge failed; marking complete fail-open", {
          sessionID: input.sessionID,
          error: String(judged.cause),
        })
        return { completed: true, goal: next, verdict }
      }

      const verdict = GoalVerdict.parse({
        ...judged.value,
        attempt: goal.react,
        messageID: input.messageID,
      })
      if (verdict.ok || verdict.impossible) {
        const next = yield* setVerdict({
          sessionID: input.sessionID,
          verdict,
          status: "complete",
        })
        return { completed: true, goal: next, verdict }
      }

      const next = yield* setVerdict({
        sessionID: input.sessionID,
        verdict,
        status: "active",
      })
      return { completed: false, goal: next, verdict }
    })

    return GoalService.of({
      create,
      update,
      set,
      get,
      getActive,
      pause,
      resume,
      delete: deleteGoal,
      clear,
      bumpReact,
      addStats,
      setVerdict,
      requestBlocked,
      requestComplete,
      evaluate,
    })
  }),
)

const goalDefaultLayer = layer.pipe(
  Layer.provide(defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
)
export { goalDefaultLayer as defaultLayer }

export * as Goal from "./goal"
