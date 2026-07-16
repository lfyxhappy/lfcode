import z from "zod"

export const RuntimeManageGroup = z.enum(["voice", "code"]).meta({ ref: "RuntimeManageGroup" })
export type RuntimeManageGroup = z.infer<typeof RuntimeManageGroup>

export const RuntimeManageSource = z.enum(["bundled", "managed", "system", "missing"]).meta({ ref: "RuntimeManageSource" })
export type RuntimeManageSource = z.infer<typeof RuntimeManageSource>

export const RuntimeManageScope = z.enum(["required", "recommended", "optional"]).meta({ ref: "RuntimeManageScope" })
export type RuntimeManageScope = z.infer<typeof RuntimeManageScope>

export const RuntimeManageItemID = z
  .enum(["voice-recorder", "ffmpeg", "python-base", "python-managed", "cpp-compiler", "java-runtime", "java-sdk", "officecli"])
  .meta({ ref: "RuntimeManageItemID" })
export type RuntimeManageItemID = z.infer<typeof RuntimeManageItemID>

export const RuntimeManageItemActions = z
  .object({
    install: z.boolean(),
    repair: z.boolean(),
    update: z.boolean().optional(),
    activate: z.boolean(),
    openPath: z.boolean(),
    viewLogs: z.boolean(),
  })
  .meta({ ref: "RuntimeManageItemActions" })
export type RuntimeManageItemActions = z.infer<typeof RuntimeManageItemActions>

export const RuntimeManageTarget = z
  .object({
    id: z.string(),
    label: z.string(),
    source: RuntimeManageSource,
    active: z.boolean(),
  })
  .meta({ ref: "RuntimeManageTarget" })
export type RuntimeManageTarget = z.infer<typeof RuntimeManageTarget>

export const RuntimeManageItem = z
  .object({
    id: RuntimeManageItemID,
    group: RuntimeManageGroup,
    title: z.string(),
    description: z.string(),
    installed: z.boolean(),
    version: z.string().optional(),
    source: RuntimeManageSource,
    scope: RuntimeManageScope,
    usedBy: z.array(z.string()),
    path: z.string().optional(),
    detail: z.string().optional(),
    targets: z.array(RuntimeManageTarget),
    actions: RuntimeManageItemActions,
  })
  .meta({ ref: "RuntimeManageItem" })
export type RuntimeManageItem = z.infer<typeof RuntimeManageItem>

export const RuntimeManageState = z
  .object({
    refreshedAt: z.number(),
    items: z.array(RuntimeManageItem),
  })
  .meta({ ref: "RuntimeManageState" })
export type RuntimeManageState = z.infer<typeof RuntimeManageState>

export const RuntimeManageMutationResult = z
  .object({
    message: z.string(),
    state: RuntimeManageState,
  })
  .meta({ ref: "RuntimeManageMutationResult" })
export type RuntimeManageMutationResult = z.infer<typeof RuntimeManageMutationResult>

export const RuntimeOperationAction = z.enum(["install", "repair", "update", "activate"]).meta({ ref: "RuntimeOperationAction" })
export type RuntimeOperationAction = z.infer<typeof RuntimeOperationAction>

export const RuntimeOperationStatus = z.enum(["success", "failed"]).meta({ ref: "RuntimeOperationStatus" })
export type RuntimeOperationStatus = z.infer<typeof RuntimeOperationStatus>

export const RuntimeOperationLog = z
  .object({
    timestamp: z.number(),
    id: RuntimeManageItemID,
    action: RuntimeOperationAction,
    status: RuntimeOperationStatus,
    title: z.string(),
    message: z.string(),
    sourceLabel: z.string().optional(),
  })
  .meta({ ref: "RuntimeOperationLog" })
export type RuntimeOperationLog = z.infer<typeof RuntimeOperationLog>

export const RuntimeOperationLogState = z
  .object({
    refreshedAt: z.number(),
    entries: z.array(RuntimeOperationLog),
  })
  .meta({ ref: "RuntimeOperationLogState" })
export type RuntimeOperationLogState = z.infer<typeof RuntimeOperationLogState>
