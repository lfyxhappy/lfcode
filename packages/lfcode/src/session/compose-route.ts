import z from "zod"
import { MessageID } from "./schema"
import type { MessageV2 } from "./message-v2"
import { isRealUserPart } from "./part-helpers"

export const ComposeRouteTaskType = z
  .enum(["bug-fix", "small-feature", "refactor", "investigation", "design", "migration", "large-project"])
  .meta({ ref: "ComposeRouteTaskType" })
export type ComposeRouteTaskType = z.infer<typeof ComposeRouteTaskType>

export const ComposeRouteDifficulty = z
  .enum(["simple", "moderate", "complex", "very-complex"])
  .meta({ ref: "ComposeRouteDifficulty" })
export type ComposeRouteDifficulty = z.infer<typeof ComposeRouteDifficulty>

export const ComposeRouteStrategy = z
  .enum(["direct-execute", "research-then-execute", "design-then-execute", "full-orchestration"])
  .meta({ ref: "ComposeRouteStrategy" })
export type ComposeRouteStrategy = z.infer<typeof ComposeRouteStrategy>

export const ComposeRouteExecutionShape = z
  .enum(["single-shot", "research-first", "design-first", "multi-workstream"])
  .meta({ ref: "ComposeRouteExecutionShape" })
export type ComposeRouteExecutionShape = z.infer<typeof ComposeRouteExecutionShape>

export const ComposeRoute = z
  .object({
    sourceMessageID: MessageID.zod,
    summary: z.string(),
    taskType: ComposeRouteTaskType,
    difficulty: ComposeRouteDifficulty,
    strategy: ComposeRouteStrategy,
    executionShape: ComposeRouteExecutionShape,
    requiresTaskBoard: z.boolean(),
    requiresPlan: z.boolean(),
    requiresReview: z.boolean(),
    requiresVerify: z.boolean(),
    reason: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "ComposeRoute" })
export type ComposeRoute = z.infer<typeof ComposeRoute>

export interface ComposeEvidence {
  readonly orchestrated: boolean
  readonly routeStructured: boolean
  readonly researchStructured: boolean
  readonly designStructured: boolean
  readonly planStructured: boolean
  readonly reviewStructured: boolean
  readonly verifyStructured: boolean
  readonly inspectStructured: boolean
  readonly inspectLightweight: boolean
  readonly planLightweight: boolean
  readonly reviewLightweight: boolean
  readonly verifyLightweight: boolean
  readonly hasPlan: boolean
  readonly hasReview: boolean
  readonly hasVerify: boolean
}

export function shouldManageComposeRoute(agent: string | undefined) {
  return agent === "compose"
}

export function getLatestComposeUserMessage(messages: MessageV2.WithParts[]) {
  return messages.findLast(
    (message) =>
      message.info.role === "user" &&
      shouldManageComposeRoute(message.info.agent) &&
      message.parts.some(isRealUserPart),
  )
}

export function classifyComposeRoute(input: { message: MessageV2.WithParts; now?: number }): ComposeRoute {
  const now = input.now ?? Date.now()
  const summary = summarizeTask(input.message)
  const task = summary.toLowerCase()
  const reasons: string[] = []
  const explicitResearchDirective = hasAny(task, [
    "先查明",
    "查明原因",
    "先调查",
    "先研究",
    "先确认原因再修",
    "先排查清楚再修",
    "research first",
    "investigate first",
    "first diagnose",
    "root cause first",
    "before fixing",
  ])
  const flags = {
    bugFix: hasAny(task, ["bug", "fix", "修复", "错误", "问题", "异常", "回归"]),
    smallFeature: hasAny(task, ["add", "support", "feature", "新增", "支持", "增加"]),
    refactor: hasAny(task, ["refactor", "cleanup", "clean up", "rework", "重构", "整理", "清理"]),
    investigation: hasAny(task, [
      "investigate",
      "investigation",
      "debug",
      "diagnose",
      "why",
      "root cause",
      "分析",
      "排查",
      "调查",
      "看一下",
      "为什么",
      "定位",
    ]),
    design: hasAny(task, ["design", "architecture", "方案", "设计", "架构", "边界", "接口设计"]),
    migration: hasAny(task, ["migration", "migrate", "upgrade", "replace", "switch", "迁移", "升级", "替换", "切换"]),
    parallel: hasAny(task, ["parallel", "并行", "多个子任务", "多线程", "multi-agent", "subagent"]),
    broadScope: hasAny(task, [
      "end-to-end",
      "across",
      "多个模块",
      "多模块",
      "大项目",
      "全链路",
      "整体",
      "系统性",
      "全面",
      "全量",
      "workflow",
      "orchestration",
      "编排",
    ]),
    verification: hasAny(task, ["test", "verify", "typecheck", "build", "验证", "测试", "构建"]),
  }

  const bulletCount = input.message.parts.filter(
    (part) => part.type === "text" && /(^|\n)\s*(?:[-*]|\d+\.)\s+/m.test(part.text),
  ).length
  const textLength = task.length
  const fileMentionCount = countMentions(task, ["/", "\\", ".ts", ".tsx", ".js", ".json", "packages/", "src/"])
  const investigationOnly =
    flags.investigation &&
    !explicitResearchDirective &&
    !flags.parallel &&
    !flags.broadScope &&
    !flags.design &&
    !flags.migration &&
    fileMentionCount < 3
  const complexityScore =
    Number(flags.parallel) * 3 +
    Number(flags.broadScope) * 3 +
    Number(flags.migration) * 3 +
    Number(flags.design) * 2 +
    Number(flags.refactor) * 2 +
    Number(flags.investigation && !investigationOnly) +
    (textLength > 500 ? 2 : 0) +
    (textLength > 1000 ? 2 : 0) +
    (bulletCount > 0 ? 1 : 0) +
    (fileMentionCount >= 3 ? 2 : 0)

  const taskType = resolveTaskType(flags)
  const difficulty =
    complexityScore >= 7
      ? "very-complex"
      : complexityScore >= 4
        ? "complex"
        : complexityScore >= 2
          ? "moderate"
          : "simple"
  const executionShape = resolveExecutionShape({ flags, difficulty, explicitResearchDirective, investigationOnly })
  const strategy = resolveStrategy({ taskType, difficulty, executionShape, explicitResearchDirective })
  const requiresTaskBoard =
    strategy === "full-orchestration" || difficulty === "very-complex" || (flags.parallel && difficulty !== "simple")
  const requiresPlan =
    strategy === "design-then-execute" ||
    strategy === "full-orchestration" ||
    (strategy === "research-then-execute" && (difficulty === "complex" || difficulty === "very-complex"))
  const requiresReview =
    strategy === "full-orchestration" ||
    taskType === "migration" ||
    (taskType === "refactor" && difficulty !== "simple") ||
    difficulty === "very-complex"
  const requiresVerify =
    difficulty !== "simple" &&
    taskType !== "investigation" &&
    taskType !== "design" &&
    (flags.verification || taskType !== "small-feature")

  if (flags.parallel) reasons.push("task spans multiple workstreams")
  if (flags.broadScope) reasons.push("task wording implies broad or cross-cutting scope")
  if (flags.design) reasons.push("design or architecture is still part of the task")
  if (explicitResearchDirective) reasons.push("the user explicitly asked for root-cause or fact-finding before implementation")
  else if (flags.investigation) reasons.push("the task benefits from inspection, but can still stay lightweight if scope remains local")
  if (flags.migration) reasons.push("migration or replacement work is usually multi-stage")
  if (flags.refactor) reasons.push("refactor work benefits from review before handoff")
  if (reasons.length === 0) reasons.push("task appears localized and well-bounded")

  const routeSummary = buildSummary({ taskType, difficulty, strategy })
  return {
    sourceMessageID: input.message.info.id,
    summary: routeSummary,
    taskType,
    difficulty,
    strategy,
    executionShape,
    requiresTaskBoard,
    requiresPlan,
    requiresReview,
    requiresVerify,
    reason: reasons.join("; "),
    time: {
      created: now,
      updated: now,
    },
  }
}

export function collectComposeEvidence(input: {
  messages: MessageV2.WithParts[]
  route: ComposeRoute
}): ComposeEvidence {
  const toolParts = input.messages.flatMap((message) => message.parts.filter((part) => part.type === "tool"))
  const completedWorkflowParts = toolParts
    .filter((part) => part.tool === "workflow" && part.state.status === "completed")
  const completedWorkflowNames = completedWorkflowParts
    .map((part) => getToolInput(part))
    .flatMap((value) => (typeof value?.name === "string" ? [value.name.toLowerCase()] : []))
  const structuredRuns = [
    ...completedWorkflowParts.flatMap((part) =>
      extractStructuredWorkflowResult(part.state.status === "completed" ? part.state.output : ""),
    ),
    ...input.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "text") return []
        return extractStructuredWorkflowResult(part.text)
      }),
    ),
  ]
  const composeRuns = structuredRuns.filter(isComposeOrchestratorRun)
  const assistantTexts = input.messages
    .flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text))
    .join("\n\n")
  const routeStructured = composeRuns.some((run) => isRecord(run.route) && typeof run.route.strategy === "string")
  const inspectStructured = composeRuns.some((run) => isInspectStageComplete(run.inspect))
  const researchStructured = inspectStructured
  const designStructured = composeRuns.some((run) => {
    if (!isRecord(run.route)) return false
    if (run.route.strategy !== "design-then-execute" && run.route.executionShape !== "design-first") return false
    return isPlanStageComplete(run.plan)
  })
  const planStructured = composeRuns.some((run) => isPlanStageComplete(run.plan))
  const reviewStructured = composeRuns.some((run) => isReviewStageComplete(run.review))
  const verifyStructured = composeRuns.some((run) => isVerifyStageComplete(run.verify))
  const inspectLightweight = hasStructuredLightweightInspect(assistantTexts)
  const planLightweight = hasStructuredLightweightPlan(assistantTexts)
  const reviewLightweight = hasStructuredLightweightReview(assistantTexts)
  const verifyLightweight = hasStructuredLightweightVerify(assistantTexts)
  const orchestrated = completedWorkflowNames.includes("compose-orchestrator") && routeStructured
  const hasPlan = planStructured || planLightweight || orchestrated
  const hasReview = reviewStructured || reviewLightweight || orchestrated
  const hasVerify = verifyStructured || verifyLightweight || orchestrated

  return {
    orchestrated,
    routeStructured,
    researchStructured,
    designStructured,
    planStructured,
    reviewStructured,
    verifyStructured,
    inspectStructured,
    inspectLightweight,
    planLightweight,
    reviewLightweight,
    verifyLightweight,
    hasPlan,
    hasReview,
    hasVerify,
  }
}

export function getMissingComposeStages(input: {
  route: ComposeRoute
  evidence: ComposeEvidence
  hasTaskBoard?: boolean
  hasOpenTasks?: boolean
  hasBlockedTasks?: boolean
}) {
  const missing: string[] = []
  if (
    input.route.strategy === "full-orchestration" &&
    !input.evidence.orchestrated &&
    !(input.evidence.hasPlan && input.evidence.hasReview && input.evidence.hasVerify)
  ) {
    missing.push("prefer the built-in compose-orchestrator workflow, or provide equivalent staged evidence for plan, review, and verify")
  }
  if (
    input.route.strategy === "research-then-execute" &&
    !input.evidence.researchStructured &&
    !input.evidence.inspectLightweight
  ) {
    missing.push("add a concise structured investigation result: what you checked, what you found, and the likely cause")
  }
  if (input.route.strategy === "design-then-execute" && !input.evidence.designStructured) {
    missing.push("settle the design boundary first with a concrete design/plan summary before broad implementation")
  }
  if (input.route.requiresTaskBoard && !input.hasTaskBoard) missing.push("create and maintain a session task board")
  if (input.route.requiresTaskBoard && input.hasBlockedTasks) missing.push("resolve or abandon blocked tasks on the task board")
  if (input.route.requiresTaskBoard && input.hasOpenTasks) missing.push("close remaining open or in-progress tasks")
  if (input.route.requiresPlan && !input.evidence.hasPlan) missing.push("produce an explicit implementation plan")
  if (input.route.requiresReview && !input.evidence.hasReview) missing.push("run an explicit review pass")
  if (input.route.requiresVerify && !input.evidence.hasVerify) missing.push("run explicit verification and record the evidence")
  return missing
}

export function buildComposeGateReminder(input: {
  route: ComposeRoute
  missing: string[]
  hasTaskBoard?: boolean
  hasBlockedTasks?: boolean
  hasOpenTasks?: boolean
}) {
  const taskBoardLine =
    input.route.requiresTaskBoard && !input.hasTaskBoard
      ? "Create a session task board with the task tool before you continue broad execution."
      : input.route.requiresTaskBoard && input.hasBlockedTasks
        ? "Blocked tasks are not a terminal state here. Resolve them or abandon them explicitly before you stop."
        : input.route.requiresTaskBoard && input.hasOpenTasks
          ? "Finish each open task with `task done` or `task abandon` before you stop."
          : undefined
  const stageLines = input.missing.map((item) => `- ${item}`)
  return [
    "<system-reminder>",
    `This compose task was routed as ${input.route.strategy} (${input.route.difficulty}, ${input.route.taskType}).`,
    `Route reason: ${input.route.reason}`,
    "Before you finish, complete the missing compose stages:",
    ...stageLines,
    ...(taskBoardLine ? [taskBoardLine] : []),
    "Take the shortest valid recovery path for the missing stages instead of restarting the whole workflow.",
    "</system-reminder>",
  ].join("\n")
}

function summarizeTask(message: MessageV2.WithParts) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text" && isRealUserPart(part)) return [part.text]
      if (part.type === "subtask") return [part.description, part.prompt]
      if (part.type === "file") return [part.filename ?? part.url]
      return []
    })
    .join("\n")
}

function hasAny(input: string, terms: string[]) {
  return terms.some((term) => input.includes(term))
}

function countMentions(input: string, terms: string[]) {
  return terms.reduce((count, term) => count + (input.includes(term.toLowerCase()) ? 1 : 0), 0)
}

function resolveTaskType(flags: {
  bugFix: boolean
  smallFeature: boolean
  refactor: boolean
  investigation: boolean
  design: boolean
  migration: boolean
  broadScope: boolean
}) {
  if (flags.migration) return "migration" satisfies ComposeRouteTaskType
  if (flags.design) return "design" satisfies ComposeRouteTaskType
  if (flags.investigation && !flags.bugFix) return "investigation" satisfies ComposeRouteTaskType
  if (flags.refactor) return "refactor" satisfies ComposeRouteTaskType
  if (flags.broadScope) return "large-project" satisfies ComposeRouteTaskType
  if (flags.bugFix) return "bug-fix" satisfies ComposeRouteTaskType
  return "small-feature" satisfies ComposeRouteTaskType
}

function resolveExecutionShape(input: {
  flags: { investigation: boolean; design: boolean; parallel: boolean; broadScope: boolean; migration: boolean }
  difficulty: ComposeRouteDifficulty
  explicitResearchDirective: boolean
  investigationOnly: boolean
}) {
  if (input.flags.parallel || input.flags.broadScope || input.flags.migration || input.difficulty === "very-complex") {
    return "multi-workstream" satisfies ComposeRouteExecutionShape
  }
  if (input.flags.design) return "design-first" satisfies ComposeRouteExecutionShape
  if (input.explicitResearchDirective) return "research-first" satisfies ComposeRouteExecutionShape
  if (input.flags.investigation && !input.investigationOnly) return "research-first" satisfies ComposeRouteExecutionShape
  return "single-shot" satisfies ComposeRouteExecutionShape
}

function resolveStrategy(input: {
  taskType: ComposeRouteTaskType
  difficulty: ComposeRouteDifficulty
  executionShape: ComposeRouteExecutionShape
  explicitResearchDirective: boolean
}) {
  if (input.executionShape === "multi-workstream") return "full-orchestration" satisfies ComposeRouteStrategy
  if (input.executionShape === "design-first") return "design-then-execute" satisfies ComposeRouteStrategy
  if (input.executionShape === "research-first" && input.explicitResearchDirective) {
    return "research-then-execute" satisfies ComposeRouteStrategy
  }
  if (input.executionShape === "research-first" && input.difficulty !== "simple") {
    return "research-then-execute" satisfies ComposeRouteStrategy
  }
  if (input.taskType === "migration" && input.difficulty !== "simple") return "full-orchestration" satisfies ComposeRouteStrategy
  return "direct-execute" satisfies ComposeRouteStrategy
}

function buildSummary(input: {
  taskType: ComposeRouteTaskType
  difficulty: ComposeRouteDifficulty
  strategy: ComposeRouteStrategy
}) {
  return `Route this ${input.difficulty} ${input.taskType} task through ${input.strategy}.`
}

function getToolInput(part: Extract<MessageV2.Part, { type: "tool" }>) {
  if (part.state.status === "pending" || part.state.status === "running") return part.state.input
  if (part.state.status === "completed") return part.state.input
  if (part.state.status === "error") return part.state.input
  return undefined
}

function extractStructuredWorkflowResult(text: string) {
  const match = text.match(/Workflow completed\.\s*run_id:\s*[^\n]+\n([\s\S]+)/i)
  const candidate = match?.[1]?.trim() ?? ""
  if (!candidate.startsWith("{")) return []
  try {
    const parsed = JSON.parse(candidate)
    return isRecord(parsed) ? [parsed] : []
  } catch {
    return []
  }
}

function isComposeOrchestratorRun(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  return "inspect" in value && "route" in value && "execute" in value && "verify" in value
}

function isInspectStageComplete(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    Array.isArray(value.files) &&
    Array.isArray(value.symbols) &&
    Array.isArray(value.tests) &&
    Array.isArray(value.evidence)
  )
}

function isPlanStageComplete(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    Array.isArray(value.workstreams) &&
    Array.isArray(value.verification)
  )
}

function isReviewStageComplete(value: unknown) {
  return (
    isRecord(value) &&
    value.passed === true &&
    typeof value.summary === "string" &&
    Array.isArray(value.drift) &&
    Array.isArray(value.gaps)
  )
}

function isVerifyStageComplete(value: unknown) {
  return (
    isRecord(value) &&
    value.passed === true &&
    typeof value.summary === "string" &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.remaining)
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null
}

function hasStructuredLightweightInspect(text: string) {
  return (
    hasAny(text.toLowerCase(), ["调查结论", "排查结论", "root cause", "likely cause", "现状结论", "inspection summary"]) &&
    hasAny(text.toLowerCase(), ["checked", "inspected", "查看了", "检查了", "读了", "搜索了", "logs", "日志", "文件", "code"])
  )
}

function hasStructuredLightweightPlan(text: string) {
  return /(^|\n)\s*(计划|plan|implementation plan|改动面|验证项)\s*[:：]/im.test(text)
}

function hasStructuredLightweightReview(text: string) {
  return /(^|\n)\s*(review|审查|复查)\s*[:：]/im.test(text)
}

function hasStructuredLightweightVerify(text: string) {
  return /(^|\n)\s*(verify|verification|验证|测试|typecheck|build)\s*[:：]/im.test(text)
}

export * as SessionComposeRoute from "./compose-route"
