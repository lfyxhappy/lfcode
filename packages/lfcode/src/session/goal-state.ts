import z from "zod"

export const Verdict = z
  .object({
    ok: z.boolean(),
    impossible: z.boolean().optional(),
    reason: z.string(),
  })
  .meta({ ref: "GoalVerdictBase" })
export type Verdict = z.infer<typeof Verdict>

export const GoalVerdict = Verdict.extend({
  attempt: z.number().int().nonnegative(),
  messageID: z.string().optional(),
  error: z.boolean().optional(),
}).meta({ ref: "GoalVerdict" })
export type GoalVerdict = z.infer<typeof GoalVerdict>

export const GoalStatus = z.enum(["active", "paused", "complete", "blocked", "cleared"]).meta({ ref: "GoalStatus" })
export type GoalStatus = z.infer<typeof GoalStatus>

export const GoalStats = z
  .object({
    tokens: z.object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      reasoning: z.number().int().nonnegative(),
      cache: z.object({
        read: z.number().int().nonnegative(),
        write: z.number().int().nonnegative(),
      }),
    }),
    elapsed: z.number().int().nonnegative(),
    started: z.number(),
    activeSince: z.number().optional(),
    pausedAt: z.number().optional(),
  })
  .meta({ ref: "GoalStats" })
export type GoalStats = z.infer<typeof GoalStats>

export const GoalState = z
  .object({
    status: GoalStatus,
    objective: z.string(),
    condition: z.string(),
    react: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    blockedReason: z.string().optional(),
    lastVerdict: GoalVerdict.optional(),
    stats: GoalStats,
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "GoalState" })
export type GoalState = z.infer<typeof GoalState>
