import z from "zod"
import { Cron } from "croner"

export const AutomationModel = z
  .object({
    providerID: z.string().trim().min(1).max(160),
    modelID: z.string().trim().min(1).max(320),
  })
  .strict()
  .meta({ ref: "AutomationModel" })
export type AutomationModel = z.infer<typeof AutomationModel>

export const AutomationPermissionMode = z.enum(["ask", "full"]).meta({ ref: "AutomationPermissionMode" })
export type AutomationPermissionMode = z.infer<typeof AutomationPermissionMode>

export const AutomationNotification = z.enum(["all", "failures", "none"]).meta({ ref: "AutomationNotification" })
export type AutomationNotification = z.infer<typeof AutomationNotification>

export const AutomationSettings = z
  .object({ concurrency: z.number().int().min(1).max(8) })
  .strict()
  .meta({ ref: "AutomationSettings" })
export type AutomationSettings = z.infer<typeof AutomationSettings>

export const AutomationTarget = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("session"), sessionID: z.string().trim().min(1).max(256) }).strict(),
    z
      .object({ kind: z.literal("project"), projectID: z.string().trim().min(1).max(256) })
      .strict()
      .refine((value) => value.projectID !== "global", "The global project ID is reserved for global automation sessions"),
    z.object({ kind: z.literal("global") }).strict(),
  ])
  .meta({ ref: "AutomationTarget" })
export type AutomationTarget = z.infer<typeof AutomationTarget>

const CronExpression = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => value.split(/\s+/).length === 5, "Cron expressions must use exactly five fields")
  .refine((value) => validCron(value), "Cron expression is invalid")

export const AutomationSchedule = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("once"), at: z.number().int().nonnegative() }).strict(),
    z
      .object({
        kind: z.literal("interval"),
        everyMs: z.number().int().min(60_000).max(366 * 24 * 60 * 60 * 1000),
        anchorAt: z.number().int().nonnegative().optional(),
      })
      .strict(),
    z.object({ kind: z.literal("cron"), expression: CronExpression }).strict(),
    z.object({ kind: z.literal("hourly"), minute: z.number().int().min(0).max(59).default(0) }).strict(),
    z
      .object({
        kind: z.literal("daily"),
        hour: z.number().int().min(0).max(23).default(9),
        minute: z.number().int().min(0).max(59).default(0),
      })
      .strict(),
    z
      .object({
        kind: z.literal("weekly"),
        dayOfWeek: z.number().int().min(0).max(6).default(1),
        hour: z.number().int().min(0).max(23).default(9),
        minute: z.number().int().min(0).max(59).default(0),
      })
      .strict(),
  ])
  .meta({ ref: "AutomationSchedule" })
export type AutomationSchedule = z.infer<typeof AutomationSchedule>

export function defaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function validTimeZone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

function validCron(value: string) {
  try {
    new Cron(value)
    return true
  } catch {
    return false
  }
}

export const AutomationTimeZone = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(validTimeZone, "Timezone must be a valid IANA timezone")
  .meta({ ref: "AutomationTimeZone" })
export type AutomationTimeZone = z.infer<typeof AutomationTimeZone>

export const AutomationTaskCreate = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    schedule: AutomationSchedule,
    target: AutomationTarget,
    message: z.string().trim().min(1).max(200_000),
    agent: z.string().trim().min(1).max(128).default("main"),
    model: AutomationModel.optional(),
    permissionMode: AutomationPermissionMode.default("full"),
    timezone: AutomationTimeZone.default(defaultTimeZone()),
    enabled: z.boolean().default(true),
    notifications: AutomationNotification.default("all"),
    sourceSessionID: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .meta({ ref: "AutomationTaskCreate" })
export type AutomationTaskCreate = z.infer<typeof AutomationTaskCreate>

export const AutomationTaskUpdate = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    schedule: AutomationSchedule.optional(),
    target: AutomationTarget.optional(),
    message: z.string().trim().min(1).max(200_000).optional(),
    agent: z.string().trim().min(1).max(128).optional(),
    model: AutomationModel.nullable().optional(),
    permissionMode: AutomationPermissionMode.optional(),
    timezone: AutomationTimeZone.optional(),
    enabled: z.boolean().optional(),
    notifications: AutomationNotification.optional(),
    sourceSessionID: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict()
  .meta({ ref: "AutomationTaskUpdate" })
export type AutomationTaskUpdate = z.infer<typeof AutomationTaskUpdate>

export const AutomationTask = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    schedule: AutomationSchedule,
    target: AutomationTarget,
    message: z.string().min(1),
    agent: z.string().min(1),
    model: AutomationModel.optional(),
    permissionMode: AutomationPermissionMode,
    timezone: AutomationTimeZone,
    enabled: z.boolean(),
    status: z.enum(["active", "paused", "completed", "deleted"]),
    notifications: AutomationNotification,
    sourceSessionID: z.string().optional(),
    nextRunAt: z.number().int().nonnegative().optional(),
    lastRunAt: z.number().int().nonnegative().optional(),
    deletedAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ ref: "AutomationTask" })
export type AutomationTask = z.infer<typeof AutomationTask>

export const AutomationRunStatus = z
  .enum(["queued", "running", "waiting_for_session", "awaiting_user", "completed", "failed", "cancelled"])
  .meta({ ref: "AutomationRunStatus" })
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>

export const AutomationRun = z
  .object({
    id: z.string().min(1),
    taskID: z.string().min(1),
    status: AutomationRunStatus,
    trigger: z.enum(["schedule", "manual", "recovery"]),
    scheduledFor: z.number().int().nonnegative(),
    late: z.boolean(),
    attempt: z.number().int().positive(),
    sessionID: z.string().optional(),
    leaseOwner: z.string().optional(),
    leaseExpiresAt: z.number().int().nonnegative().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ ref: "AutomationRun" })
export type AutomationRun = z.infer<typeof AutomationRun>

export const AutomationRunExecution = z
  .object({
    status: z.enum(["completed", "waiting_for_session", "awaiting_user"]).default("completed"),
    sessionID: z.string().trim().min(1).max(256).optional(),
    result: z.string().max(200_000).optional(),
  })
  .strict()
  .meta({ ref: "AutomationRunExecution" })
export type AutomationRunExecution = z.infer<typeof AutomationRunExecution>
