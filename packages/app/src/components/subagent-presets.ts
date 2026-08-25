export type SubagentExecution = "wait" | "background"
export type SubagentContext = "none" | "state" | "full"

export type SubagentPreset = {
  id: string
  title: string
  description: string
  execution: SubagentExecution
  context: SubagentContext
  avatar: number
  toolAllowlist: string[]
}

const writeTools = ["read", "glob", "grep", "edit", "apply_patch", "bash"]
const readTools = ["read", "glob", "grep"]

export const SUBAGENT_PRESETS: SubagentPreset[] = [
  {
    id: "general",
    title: "通用协作者",
    description: "处理边界清楚的多步骤协作任务。",
    execution: "background",
    context: "state",
    avatar: 0,
    toolAllowlist: writeTools,
  },
  {
    id: "explore",
    title: "代码探索",
    description: "快速定位代码、配置、调用链和风险。",
    execution: "background",
    context: "state",
    avatar: 1,
    toolAllowlist: readTools,
  },
  {
    id: "planner",
    title: "实施规划",
    description: "拆解目标、识别约束并形成可执行计划。",
    execution: "wait",
    context: "full",
    avatar: 2,
    toolAllowlist: readTools,
  },
  {
    id: "implementer",
    title: "实现工程师",
    description: "在限定文件范围内完成实现与定向验证。",
    execution: "wait",
    context: "state",
    avatar: 3,
    toolAllowlist: writeTools,
  },
  {
    id: "reviewer",
    title: "代码审查",
    description: "识别缺陷、回归风险和缺失测试。",
    execution: "background",
    context: "full",
    avatar: 4,
    toolAllowlist: ["read", "glob", "grep", "git"],
  },
  {
    id: "tester",
    title: "测试工程师",
    description: "设计并执行针对性验证，报告可复现证据。",
    execution: "background",
    context: "state",
    avatar: 5,
    toolAllowlist: ["read", "glob", "grep", "bash"],
  },
  {
    id: "debugger",
    title: "故障诊断",
    description: "复现问题，收集日志并定位根因。",
    execution: "background",
    context: "state",
    avatar: 6,
    toolAllowlist: ["read", "glob", "grep", "bash"],
  },
  {
    id: "frontend",
    title: "前端工程师",
    description: "实现并验证界面、交互、可访问性和响应式布局。",
    execution: "wait",
    context: "state",
    avatar: 7,
    toolAllowlist: writeTools,
  },
  {
    id: "docs",
    title: "文档工程师",
    description: "维护面向用户和开发者的准确文档。",
    execution: "background",
    context: "state",
    avatar: 8,
    toolAllowlist: ["read", "glob", "grep", "edit", "apply_patch"],
  },
  {
    id: "researcher",
    title: "技术研究",
    description: "收集、比较并综合外部技术资料。",
    execution: "background",
    context: "none",
    avatar: 9,
    toolAllowlist: ["read", "glob", "grep", "webfetch", "websearch"],
  },
  {
    id: "security",
    title: "安全审查",
    description: "检查信任边界、权限、输入和敏感数据风险。",
    execution: "background",
    context: "full",
    avatar: 10,
    toolAllowlist: readTools,
  },
  {
    id: "performance",
    title: "性能分析",
    description: "定位瓶颈并给出可验证的优化建议。",
    execution: "background",
    context: "state",
    avatar: 11,
    toolAllowlist: ["read", "glob", "grep", "bash"],
  },
  {
    id: "database",
    title: "数据库工程师",
    description: "设计数据变更、迁移和查询验证。",
    execution: "wait",
    context: "state",
    avatar: 12,
    toolAllowlist: writeTools,
  },
  {
    id: "release",
    title: "发布工程师",
    description: "核对构建、发布材料与明确的发布确认链。",
    execution: "wait",
    context: "state",
    avatar: 13,
    toolAllowlist: ["read", "glob", "grep", "bash", "git"],
  },
]

export function subagentPreset(id: string | undefined) {
  return SUBAGENT_PRESETS.find((item) => item.id === id)
}

export function subagentPresetTitle(id: string | undefined) {
  return subagentPreset(id)?.title ?? id ?? "子智能体"
}

export function subagentPresetExecution(id: string | undefined): SubagentExecution {
  return subagentPreset(id)?.execution ?? "background"
}

export function subagentPresetContext(id: string | undefined): SubagentContext {
  return subagentPreset(id)?.context ?? "state"
}
