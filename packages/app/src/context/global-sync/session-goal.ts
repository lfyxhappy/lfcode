import type { SessionGoal } from "./types"

type GoalVerdictLike = {
  ok?: boolean
  impossible?: boolean
  reason?: string
  attempt?: number
  messageID?: string
  error?: boolean
}

type GoalStateLike = {
  status?: string
  objective?: string
  condition?: string
  react?: number
  blockedCount?: number
  blockedReason?: string
  stats?: {
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: {
        read?: number
        write?: number
      }
    }
    elapsed?: number
    started?: number
    activeSince?: number
    pausedAt?: number
  }
  lastVerdict?: GoalVerdictLike
  time?: {
    created?: number
    updated?: number
  }
}

function normalizeVerdict(input?: GoalVerdictLike) {
  if (!input || typeof input.ok !== "boolean" || typeof input.reason !== "string" || typeof input.attempt !== "number")
    return
  return {
    ok: input.ok,
    impossible: input.impossible,
    reason: input.reason,
    attempt: input.attempt,
    messageID: input.messageID,
    error: input.error,
  }
}

function normalizeGoalState(input?: GoalStateLike) {
  if (!input || typeof input.condition !== "string") return
  return {
    status: input.status,
    objective: input.objective,
    condition: input.condition,
    react: input.react,
    blockedCount: input.blockedCount,
    blockedReason: input.blockedReason,
    stats: input.stats
      ? {
          tokens: input.stats.tokens
            ? {
                input: input.stats.tokens.input,
                output: input.stats.tokens.output,
                reasoning: input.stats.tokens.reasoning,
                cache: input.stats.tokens.cache
                  ? {
                      read: input.stats.tokens.cache.read,
                      write: input.stats.tokens.cache.write,
                    }
                  : undefined,
              }
            : undefined,
          elapsed: input.stats.elapsed,
          started: input.stats.started,
          activeSince: input.stats.activeSince,
          pausedAt: input.stats.pausedAt,
        }
      : undefined,
    time:
      input.time && typeof input.time.created === "number" && typeof input.time.updated === "number"
        ? {
            created: input.time.created,
            updated: input.time.updated,
          }
        : undefined,
    lastVerdict: normalizeVerdict(input.lastVerdict),
  }
}

export function mergeSessionGoal(
  previous: SessionGoal | undefined,
  input: {
    goal?: GoalStateLike
    lastVerdict?: GoalVerdictLike
  },
): SessionGoal | undefined {
  const verdicts = { ...(previous?.verdicts ?? {}) }
  const verdict = normalizeVerdict(input.lastVerdict ?? input.goal?.lastVerdict)
  let lastMessageID = previous?.lastMessageID
  if (verdict?.messageID) {
    verdicts[verdict.messageID] = {
      ok: verdict.ok,
      impossible: verdict.impossible,
      reason: verdict.reason,
      attempt: verdict.attempt,
      error: verdict.error,
    }
    lastMessageID = verdict.messageID
  }
  const state = normalizeGoalState(input.goal)
  if (!state && Object.keys(verdicts).length === 0 && !lastMessageID) return
  return {
    state,
    verdicts,
    lastMessageID,
  }
}
