import z from "zod"
import PROMPT_EXPLORE from "./prompt/explore.txt"

export const Execution = z.enum(["wait", "background"])
export type Execution = z.infer<typeof Execution>

export const Context = z.enum(["minimal", "full", "task"])
export type Context = z.infer<typeof Context>

export const ModelInheritance = z.enum(["primary", "configured"])
export type ModelInheritance = z.infer<typeof ModelInheritance>

export const Info = z
  .object({
    id: z.string(),
    displayName: z.string(),
    description: z.string(),
    avatar: z.string(),
    icon: z.string(),
    color: z.string(),
    defaultExecution: Execution,
    defaultContext: Context,
    modelInheritance: ModelInheritance,
    delegationAllowlist: z.array(z.string()).optional(),
    permission: z.record(z.string(), z.union([z.enum(["allow", "deny", "ask"]), z.record(z.string(), z.enum(["allow", "deny", "ask"]))])),
    toolAllowlist: z.array(z.string()).optional(),
    prompt: z.string().optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .meta({ ref: "AgentPreset" })
export type Info = z.infer<typeof Info>

const readOnlyTools = ["read", "search", "webfetch", "websearch", "skill"]
const diagnosisTools = [...readOnlyTools, "shell", "shell_process"]
const implementationTools = [...diagnosisTools, "edit", "task"]
const testerTools = [...diagnosisTools, "edit"]

const readOnlyPermission = {
  "*": "deny",
  read: "allow",
  search: "allow",
  webfetch: "allow",
  websearch: "allow",
  actor: "deny",
} as const

const implementationPermission = {
  ...readOnlyPermission,
  edit: "ask",
  shell: "ask",
  skill: "allow",
  task: "allow",
} as const

const testerPermission = {
  ...readOnlyPermission,
  shell: "ask",
  edit: "ask",
} as const

const researchCoordinatorPermission = {
  ...readOnlyPermission,
  actor: "allow",
} as const

export const presets: readonly Info[] = [
  {
    id: "general",
    displayName: "通用执行",
    description: "处理需要多步分析、实现和核验的通用工程任务。",
    avatar: "general",
    icon: "bot",
    color: "#aac4e1",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: implementationPermission,
    toolAllowlist: implementationTools,
  },
  {
    id: "explore",
    displayName: "代码探索",
    description: "快速定位文件、调用链、配置和现有实现，只做只读调查。",
    avatar: "explore",
    icon: "search",
    color: "#f5c9b0",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: readOnlyPermission,
    toolAllowlist: readOnlyTools,
    prompt: PROMPT_EXPLORE,
  },
  {
    id: "planner",
    displayName: "规划师",
    description: "拆解需求、识别风险并给出可执行的实施计划。",
    avatar: "planner",
    icon: "map",
    color: "#8fb7a3",
    defaultExecution: "wait",
    defaultContext: "full",
    modelInheritance: "primary",
    permission: readOnlyPermission,
    toolAllowlist: readOnlyTools,
    prompt: "分析目标、现状和约束，输出分阶段的实施计划、风险和验证项。不要修改文件。",
  },
  {
    id: "implementer",
    displayName: "实现工程师",
    description: "在明确范围内实现功能、修复问题并做定向验证。",
    avatar: "implementer",
    icon: "hammer",
    color: "#78a8d8",
    defaultExecution: "wait",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: implementationPermission,
    toolAllowlist: implementationTools,
    prompt: "先检查现状，再在授权范围内完成实现。保留既有改动，并报告验证结果。",
  },
  {
    id: "reviewer",
    displayName: "代码审查",
    description: "审查变更中的缺陷、回归风险和测试缺口。",
    avatar: "reviewer",
    icon: "clipboard-check",
    color: "#c7a5dc",
    defaultExecution: "background",
    defaultContext: "full",
    modelInheritance: "primary",
    permission: readOnlyPermission,
    toolAllowlist: readOnlyTools,
    prompt: "以代码审查方式输出按严重性排序的问题、证据、风险和缺失测试。不要修改文件。",
  },
  {
    id: "tester",
    displayName: "测试工程师",
    description: "设计并执行定向测试，定位失败并提供可复现证据。",
    avatar: "tester",
    icon: "flask-conical",
    color: "#e3b56d",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: testerPermission,
    toolAllowlist: testerTools,
    prompt:
      "优先运行最小相关验证，记录命令、结果和未覆盖的风险。可以用 edit 创建或更新测试与审查文档；新文件必须使用 operation=write，已有文件使用明确的 edit 操作。不要修改业务功能文件。",
  },
  {
    id: "debugger",
    displayName: "故障排查",
    description: "复现问题、收集日志和代码证据，并定位根因。",
    avatar: "debugger",
    icon: "bug",
    color: "#dc8d7a",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: { ...readOnlyPermission, shell: "ask" },
    toolAllowlist: diagnosisTools,
    prompt: "先稳定复现，再用日志、调用链和最小实验定位根因。除非明确要求，不要修改文件。",
  },
  {
    id: "frontend",
    displayName: "前端工程师",
    description: "实现和验证界面、交互、可访问性与响应式体验。",
    avatar: "frontend",
    icon: "panels-top-left",
    color: "#6db9b0",
    defaultExecution: "wait",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: implementationPermission,
    toolAllowlist: implementationTools,
    prompt: "遵循现有设计系统实现界面，并用真实页面或定向测试验证交互和错误状态。",
  },
  {
    id: "docs",
    displayName: "文档工程师",
    description: "维护面向用户或开发者的说明、变更记录和示例。",
    avatar: "docs",
    icon: "book-open",
    color: "#b5a77c",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: { ...readOnlyPermission, edit: "ask", task: "allow" },
    toolAllowlist: [...readOnlyTools, "edit", "task"],
    prompt: "核对代码实际行为后更新必要文档，避免宣称未经验证的能力。",
  },
  {
    id: "researcher",
    displayName: "研究员",
    description: "收集并综合外部资料、规范和技术方案。",
    avatar: "researcher",
    icon: "library-big",
    color: "#9aa6d9",
    defaultExecution: "background",
    defaultContext: "task",
    modelInheritance: "primary",
    permission: readOnlyPermission,
    toolAllowlist: readOnlyTools,
    prompt: "检索可靠来源，区分事实、推断和不确定项，并给出可追溯结论。",
  },
  {
    id: "deep-research-coordinator",
    displayName: "深度研究协调者",
    description: "协调联网调查、来源核验和结构化研究报告。",
    avatar: "researcher",
    icon: "globe-2",
    color: "#7187c4",
    defaultExecution: "background",
    defaultContext: "task",
    modelInheritance: "primary",
    delegationAllowlist: ["researcher"],
    permission: researchCoordinatorPermission,
    toolAllowlist: [...readOnlyTools, "actor"],
    prompt: "你是联网研究协调者，必须执行而不是只输出计划。第一轮先使用 actor 工具以 background 方式派发 1-3 个 subagent_type=researcher 的只读调查，覆盖主证据、互补证据和反证核验；绝不选择或派发 deep-research-coordinator，研究员不得继续派发。研究员完成后，用 actor.wait 获取结果并综合为一份带 URL 引用的报告，明确区分事实、推断和未知。没有创建所需调查或没有综合结果时，不得结束。不要修改项目文件。",
    hidden: true,
  },
  {
    id: "security",
    displayName: "安全审查",
    description: "识别认证、授权、数据暴露和供应链安全风险。",
    avatar: "security",
    icon: "shield-check",
    color: "#d88f9f",
    defaultExecution: "background",
    defaultContext: "full",
    modelInheritance: "primary",
    permission: readOnlyPermission,
    toolAllowlist: readOnlyTools,
    prompt: "审查安全边界、输入验证、权限和敏感数据处理，按风险级别给出证据与修复建议。不要修改文件。",
  },
  {
    id: "performance",
    displayName: "性能分析",
    description: "定位性能瓶颈、资源浪费和可量化的优化机会。",
    avatar: "performance",
    icon: "gauge",
    color: "#caad74",
    defaultExecution: "background",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: { ...readOnlyPermission, shell: "ask" },
    toolAllowlist: diagnosisTools,
    prompt: "基于测量和调用路径识别性能问题，说明基线、假设和验证方法。不要修改文件。",
  },
  {
    id: "database",
    displayName: "数据库工程师",
    description: "设计数据模型、迁移、查询和数据一致性方案。",
    avatar: "database",
    icon: "database",
    color: "#7da9c8",
    defaultExecution: "wait",
    defaultContext: "minimal",
    modelInheritance: "primary",
    permission: implementationPermission,
    toolAllowlist: implementationTools,
    prompt: "审慎处理数据模型和迁移，先分析兼容性、回滚和真实数据风险，再实施并验证。",
  },
  {
    id: "release",
    displayName: "发布工程师",
    description: "核验构建、发布清单、版本和部署前置条件。",
    avatar: "release",
    icon: "rocket",
    color: "#d59664",
    defaultExecution: "wait",
    defaultContext: "full",
    modelInheritance: "primary",
    permission: { ...readOnlyPermission, shell: "ask", task: "allow" },
    toolAllowlist: [...diagnosisTools, "task"],
    prompt: "核对发布前置条件、构建产物和回滚路径。不要发布、推送或操作生产环境，除非用户在当前任务中明确批准。",
  },
] satisfies readonly Info[]

const byID = new Map(presets.map((preset) => [preset.id, preset]))

export function get(id: string) {
  return byID.get(id)
}

export function has(id: string) {
  return byID.has(id)
}

export function ids() {
  return presets.map((preset) => preset.id)
}

export const reserved = new Set([
  "build",
  "plan",
  "max",
  "compose",
  "title",
  "summary",
  "compaction",
  "checkpoint-writer",
  "dream",
  "distill",
])

export function isManaged(id: string) {
  return has(id) || !reserved.has(id)
}

export const AgentPreset = {
  Execution,
  Context,
  ModelInheritance,
  presets,
  get,
  has,
  ids,
  reserved,
  isManaged,
}
