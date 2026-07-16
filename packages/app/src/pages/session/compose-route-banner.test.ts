import { describe, expect, test } from "bun:test"
import {
  composeDifficultyLabel,
  composeRequirementLabels,
  composeRuntimeSummary,
  composeStrategyLabel,
  composeTaskTypeLabel,
} from "./compose-route-banner"

const baseRoute = {
  sourceMessageID: "msg_1",
  summary: "route summary",
  taskType: "small-feature" as const,
  difficulty: "simple" as const,
  strategy: "direct-execute" as const,
  executionShape: "single-shot" as const,
  requiresTaskBoard: false,
  requiresPlan: false,
  requiresReview: false,
  requiresVerify: false,
  reason: "task appears localized and well-bounded",
  time: { created: 1, updated: 1 },
}

describe("compose route banner helpers", () => {
  test("formats route labels for direct and orchestrated strategies", () => {
    expect(composeStrategyLabel("direct-execute")).toBe("直接执行")
    expect(composeStrategyLabel("full-orchestration")).toBe("完整编排")
    expect(composeDifficultyLabel("very-complex")).toBe("很复杂")
    expect(composeTaskTypeLabel("migration")).toBe("迁移")
  })

  test("summarizes the runtime split between light and heavy compose routes", () => {
    expect(composeRuntimeSummary(baseRoute)).toContain("本地化直做路径")
    expect(
      composeRuntimeSummary({
        ...baseRoute,
        strategy: "full-orchestration",
      }),
    ).toContain("workflow、任务板和并行子代理")
  })

  test("lists only the required finish gates", () => {
    expect(composeRequirementLabels(baseRoute)).toEqual([])
    expect(
      composeRequirementLabels({
        ...baseRoute,
        strategy: "full-orchestration",
        taskType: "migration",
        difficulty: "very-complex",
        executionShape: "multi-workstream",
        requiresTaskBoard: true,
        requiresPlan: true,
        requiresReview: true,
        requiresVerify: true,
      }),
    ).toEqual(["任务板", "计划", "审查", "验证"])
  })
})
