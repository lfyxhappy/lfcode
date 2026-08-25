import z from "zod"

export const HookEvent = z.enum([
  "SessionStart", "Setup", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay",
  "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionDenied",
  "Notification", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle",
  "ConfigChange", "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact",
  "SessionEnd", "Elicitation", "ElicitationResult",
])
export type HookEvent = z.infer<typeof HookEvent>

export const HookScope = z.enum(["global", "project", "session"])
export const HookLifetime = z.enum(["permanent", "temporary"])
export const HookExpiry = z.object({
  kind: z.enum(["once", "max_runs", "current_turn", "session_end", "expires_at"]),
  maxRuns: z.number().int().positive().optional(),
  expiresAt: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "max_runs" && !value.maxRuns) ctx.addIssue({ code: "custom", message: "max_runs requires maxRuns" })
  if (value.kind === "expires_at" && !value.expiresAt) ctx.addIssue({ code: "custom", message: "expires_at requires expiresAt" })
})

export const HookHandler = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), command: z.string().min(1), shell: z.enum(["auto", "powershell", "sh"]).default("auto"), timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000), async: z.boolean().default(false), blockOnNonZero: z.boolean().default(false) }),
  z.object({ type: z.literal("prompt"), prompt: z.string().min(1), timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000) }),
])

export const HookDefinitionInput = z.object({
  name: z.string().min(1).max(100), description: z.string().max(1_000).default(""), enabled: z.boolean().default(true),
  scope: HookScope, projectID: z.string().optional(), sessionID: z.string().optional(), ownerSessionID: z.string().optional(),
  events: HookEvent.array().min(1), matcher: z.string().max(500).default("*"), handler: HookHandler,
  lifetime: HookLifetime.default("permanent"), expiry: HookExpiry.optional(), source: z.enum(["model", "user", "import"]).default("user"),
}).superRefine((value, ctx) => {
  if (value.scope === "project" && !value.projectID) ctx.addIssue({ code: "custom", path: ["projectID"], message: "project scope requires projectID" })
  if (value.scope === "session" && !value.sessionID) ctx.addIssue({ code: "custom", path: ["sessionID"], message: "session scope requires sessionID" })
  if (value.lifetime === "temporary" && !value.expiry) ctx.addIssue({ code: "custom", path: ["expiry"], message: "temporary Hook requires expiry" })
})

export const HookDefinition = HookDefinitionInput.safeExtend({
  id: z.string(), remainingRuns: z.number().int().nullable(), expiredAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int(),
})
export type HookDefinition = z.infer<typeof HookDefinition>
export type HookDefinitionInput = z.input<typeof HookDefinitionInput>

export const HookRun = z.object({
  id: z.string(), hookID: z.string(), sessionID: z.string().optional(), event: HookEvent, status: z.enum(["started", "completed", "blocked", "failed", "timeout", "skipped"]),
  durationMs: z.number().int().nonnegative(), summary: z.string(), input: z.record(z.string(), z.unknown()), output: z.record(z.string(), z.unknown()), timeCreated: z.number().int(),
})
export type HookRun = z.infer<typeof HookRun>

export type HookDispatchInput = {
  event: HookEvent; sessionID?: string; projectID?: string; parentSessionIDs?: string[]; cwd?: string; tool?: string; payload?: Record<string, unknown>; currentTurnID?: string
  promptEvaluator?: (input: { prompt: string; event: Omit<HookDispatchInput, "promptEvaluator">; timeoutMs: number }) => Promise<{ decision: "allow" | "block" | "ask"; reason?: string; additionalContext?: string }>
}
export type HookDispatchResult = { blocked: boolean; additionalContext: string[]; runs: HookRun[] }
