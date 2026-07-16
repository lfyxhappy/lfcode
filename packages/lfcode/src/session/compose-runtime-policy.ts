import type { ComposeRoute } from "./compose-route"

export interface ComposeRuntimePolicy {
  readonly strategy: ComposeRoute["strategy"]
  readonly requireWorkflow: boolean
  readonly allowParallelActors: boolean
  readonly allowWorkflowTool: boolean
  readonly allowTaskTool: boolean
  readonly memoryPriority: "disabled-by-default" | "current-facts-first" | "history-when-needed" | "available-but-secondary"
  readonly memoryPreface: string
}

export function resolveComposeRuntimePolicy(route: ComposeRoute): ComposeRuntimePolicy {
  switch (route.strategy) {
    case "full-orchestration":
      return {
        strategy: route.strategy,
        requireWorkflow: true,
        allowParallelActors: true,
        allowWorkflowTool: true,
        allowTaskTool: true,
        memoryPriority: "available-but-secondary",
        memoryPreface: "Prefer current repo state, runtime evidence, and task-board/workflow state before memory.",
      }
    case "research-then-execute":
      return {
        strategy: route.strategy,
        requireWorkflow: false,
        allowParallelActors: false,
        allowWorkflowTool: true,
        allowTaskTool: false,
        memoryPriority: "current-facts-first",
        memoryPreface: "Inspect the current repo, runtime, logs, and UI first. Use memory only if the investigation points to prior decisions or cross-session context.",
      }
    case "design-then-execute":
      return {
        strategy: route.strategy,
        requireWorkflow: false,
        allowParallelActors: false,
        allowWorkflowTool: true,
        allowTaskTool: false,
        memoryPriority: "history-when-needed",
        memoryPreface: "Use memory only when historical decisions or durable architecture constraints are directly relevant to the design boundary.",
      }
    case "direct-execute":
      return {
        strategy: route.strategy,
        requireWorkflow: false,
        allowParallelActors: false,
        allowWorkflowTool: false,
        allowTaskTool: false,
        memoryPriority: "disabled-by-default",
        memoryPreface: "Do not start with memory for localized execution. Only consult it if the user explicitly asks for history or a durable prior decision matters.",
      }
  }
}

export function isComposeRuntimeToolAllowed(policy: ComposeRuntimePolicy, toolID: string) {
  if (toolID === "actor") return policy.allowParallelActors
  if (toolID === "workflow") return policy.allowWorkflowTool
  if (toolID === "task") return policy.allowTaskTool
  return true
}
