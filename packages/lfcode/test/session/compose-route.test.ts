import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import {
  buildComposeGateReminder,
  classifyComposeRoute,
  collectComposeEvidence,
  getMissingComposeStages,
} from "../../src/session/compose-route"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

afterEach(async () => {
  await Instance.disposeAll()
})

const env = Layer.mergeAll(CrossSpawnSpawner.defaultLayer, Bus.defaultLayer, Session.defaultLayer)
const it = testEffect(env)
const sessionID = SessionID.make("01HSESSION0000000000000001")
const userMessageID = MessageID.make("01HUSER0000000000000000001")
const assistantMessageID1 = MessageID.make("01HASST0000000000000000001")
const assistantMessageID2 = MessageID.make("01HASST0000000000000000002")
const assistantMessageID3 = MessageID.make("01HASST0000000000000000003")
const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")

function composeUserMessage(text: string): MessageV2.WithParts {
  return {
    info: {
      id: userMessageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "compose",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: PartID.make("01HPART0000000000000000001"),
        messageID: userMessageID,
        sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function assistantText(text: string): MessageV2.WithParts {
  return {
    info: {
      id: assistantMessageID1,
      sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      parentID: userMessageID,
      modelID,
      providerID,
      mode: "chat",
      agent: "compose",
      path: { cwd: "C:\\repo", root: "C:\\repo" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: PartID.make("01HPART0000000000000000002"),
        messageID: assistantMessageID1,
        sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function assistantWorkflow(name: string): MessageV2.WithParts {
  return {
    info: {
      id: assistantMessageID2,
      sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      parentID: userMessageID,
      modelID,
      providerID,
      mode: "chat",
      agent: "compose",
      path: { cwd: "C:\\repo", root: "C:\\repo" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: PartID.make("01HPART0000000000000000003"),
        messageID: assistantMessageID2,
        sessionID,
        type: "tool",
        callID: "call_workflow",
        tool: "workflow",
        state: {
          status: "completed",
          input: {
            operation: "run",
            name,
          },
          output: "done",
          title: "workflow started",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      },
    ],
  }
}

function workflowNotification(result: Record<string, unknown>): MessageV2.WithParts {
  return assistantText(`Workflow completed. run_id: wf_test\n${JSON.stringify(result)}`)
}

function assistantSkill(name: string): MessageV2.WithParts {
  return {
    info: {
      id: assistantMessageID3,
      sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      parentID: userMessageID,
      modelID,
      providerID,
      mode: "chat",
      agent: "compose",
      path: { cwd: "C:\\repo", root: "C:\\repo" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: PartID.make("01HPART0000000000000000004"),
        messageID: assistantMessageID3,
        sessionID,
        type: "tool",
        callID: "call_skill",
        tool: "skill",
        state: {
          status: "completed",
          input: { name },
          output: "loaded",
          title: "skill loaded",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      },
    ],
  }
}

describe("compose route classification", () => {
  test("keeps small localized fixes on the direct path", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("修复设置页里一个按钮文案错别字，并补最小验证。"),
    })
    expect(route.strategy).toBe("direct-execute")
    expect(route.requiresTaskBoard).toBe(false)
    expect(route.requiresPlan).toBe(false)
  })

  test("keeps simple Chinese investigation wording on the direct path unless root-cause-first is explicit", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("看一下这个按钮为什么没反应，顺手修掉。"),
    })
    expect(route.taskType).toBe("investigation")
    expect(route.strategy).toBe("direct-execute")

    const researchRoute = classifyComposeRoute({
      message: composeUserMessage("先查明这个问题的真实原因，再决定怎么修。"),
    })
    expect(researchRoute.strategy).toBe("research-then-execute")
  })

  test("routes broad migration work into full orchestration", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。"),
    })
    expect(route.strategy).toBe("full-orchestration")
    expect(route.requiresTaskBoard).toBe(true)
    expect(route.requiresPlan).toBe(true)
    expect(route.requiresReview).toBe(true)
  })
})

describe("compose route evidence", () => {
  test("compose orchestrator structured completion satisfies plan review and verify evidence", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。"),
    })
    const evidence = collectComposeEvidence({
      route,
      messages: [
        composeUserMessage("并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。"),
        assistantWorkflow("compose-orchestrator"),
        workflowNotification({
          inspect: {
            summary: "inspection done",
            files: ["a.ts"],
            symbols: ["alpha"],
            tests: ["a.test.ts"],
            evidence: ["runtime"],
          },
          route: {
            strategy: "full-orchestration",
            executionShape: "multi-workstream",
          },
          plan: {
            summary: "plan ready",
            workstreams: [{ id: "W1" }],
            verification: ["bun test"],
          },
          execute: ["done"],
          review: {
            passed: true,
            summary: "review ok",
            drift: [],
            gaps: [],
          },
          verify: {
            passed: true,
            summary: "verify ok",
            evidence: ["bun test passed"],
            remaining: [],
          },
        }),
      ],
    })
    expect(evidence.orchestrated).toBe(true)
    expect(evidence.routeStructured).toBe(true)
    expect(evidence.planStructured).toBe(true)
    expect(evidence.reviewStructured).toBe(true)
    expect(evidence.verifyStructured).toBe(true)
    expect(evidence.hasPlan).toBe(true)
    expect(evidence.hasReview).toBe(true)
    expect(evidence.hasVerify).toBe(true)
  })

  test("loading a compose skill alone does not count as completing a stage", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("先做方案设计，再实现。"),
    })
    const evidence = collectComposeEvidence({
      route,
      messages: [composeUserMessage("先做方案设计，再实现。"), assistantSkill("compose:plan")],
    })
    expect(evidence.hasPlan).toBe(false)
  })

  test("lightweight structured text evidence can satisfy non-orchestrated compose stages", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("先查明这个问题的真实原因，再决定怎么修。"),
    })
    const evidence = collectComposeEvidence({
      route,
      messages: [
        composeUserMessage("先查明这个问题的真实原因，再决定怎么修。"),
        assistantText(
          [
            "调查结论：我检查了 session.tsx、相关日志和滚动恢复链路，问题来自重复的 anchor 恢复。",
            "计划：删掉重复恢复 effect，保留像素恢复为主链。",
          ].join("\n"),
        ),
      ],
    })
    const missing = getMissingComposeStages({
      route,
      evidence,
      hasTaskBoard: false,
      hasOpenTasks: false,
      hasBlockedTasks: false,
    })
    expect(evidence.inspectLightweight).toBe(true)
    expect(evidence.planLightweight).toBe(true)
    expect(missing).not.toContain("add a concise structured investigation result: what you checked, what you found, and the likely cause")
    expect(missing).not.toContain("produce an explicit implementation plan")
  })

  test("plain text plan review verify claims alone are still insufficient for full orchestration", () => {
    const route = classifyComposeRoute({
      message: composeUserMessage("并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。"),
    })
    const evidence = collectComposeEvidence({
      route,
      messages: [
        composeUserMessage("并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。"),
        assistantText("Plan: split into two workstreams."),
      ],
    })
    const missing = getMissingComposeStages({
      route,
      evidence,
      hasTaskBoard: false,
      hasOpenTasks: false,
      hasBlockedTasks: false,
    })
    expect(evidence.hasPlan).toBe(true)
    expect(missing).toContain("create and maintain a session task board")
    expect(missing).toContain("prefer the built-in compose-orchestrator workflow, or provide equivalent staged evidence for plan, review, and verify")
    expect(missing).toContain("run an explicit review pass")
    expect(missing).toContain("run explicit verification and record the evidence")
    expect(buildComposeGateReminder({ route, missing, hasTaskBoard: false })).toContain("shortest valid recovery path")
  })

  test("research and design routes require distinct structured front-loaded evidence", () => {
    const researchRoute = classifyComposeRoute({
      message: composeUserMessage("先排查当前行为和真实原因，再做实现修复。"),
    })
    const researchEvidence = collectComposeEvidence({
      route: researchRoute,
      messages: [
        composeUserMessage("先排查当前行为和真实原因，再做实现修复。"),
        assistantWorkflow("compose-orchestrator"),
        workflowNotification({
          inspect: {
            summary: "facts gathered",
            files: ["a.ts"],
            symbols: ["alpha"],
            tests: ["a.test.ts"],
            evidence: ["runtime"],
          },
          route: {
            strategy: "research-then-execute",
            executionShape: "research-first",
          },
          execute: ["done"],
          review: { passed: true, summary: "review skipped", drift: [], gaps: [] },
          verify: { passed: true, summary: "verify ok", evidence: ["manual"], remaining: [] },
        }),
      ],
    })
    expect(researchEvidence.researchStructured).toBe(true)
    expect(
      getMissingComposeStages({
        route: researchRoute,
        evidence: researchEvidence,
      }),
    ).not.toContain("complete a structured research/inspection stage before execution")

    const designRoute = classifyComposeRoute({
      message: composeUserMessage("先做方案设计和接口边界，再实现。"),
    })
    const designEvidence = collectComposeEvidence({
      route: designRoute,
      messages: [
        composeUserMessage("先做方案设计和接口边界，再实现。"),
        assistantWorkflow("compose-orchestrator"),
        workflowNotification({
          inspect: {
            summary: "inspection",
            files: ["api.ts"],
            symbols: ["createApi"],
            tests: ["api.test.ts"],
            evidence: ["docs"],
          },
          route: {
            strategy: "design-then-execute",
            executionShape: "design-first",
          },
          plan: {
            summary: "design settled",
            workstreams: [{ id: "W1" }],
            verification: ["bun test"],
          },
          execute: ["done"],
          review: { passed: true, summary: "review skipped", drift: [], gaps: [] },
          verify: { passed: true, summary: "verify ok", evidence: ["bun test"], remaining: [] },
        }),
      ],
    })
    expect(designEvidence.designStructured).toBe(true)
    expect(
      getMissingComposeStages({
        route: designRoute,
        evidence: designEvidence,
      }),
    ).not.toContain("complete a structured design stage before broad implementation")
  })
})

describe("compose route session persistence", () => {
  it.live("stores compose route on the session record", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create({ title: "compose route persistence" })
        const route = classifyComposeRoute({
          message: {
            info: {
              id: MessageID.make("01HUSER0000000000000000099"),
              sessionID: created.id,
              role: "user",
              time: { created: Date.now() },
              agent: "compose",
              model: { providerID, modelID },
            },
            parts: [
              {
                id: PartID.make("01HPART0000000000000000099"),
                messageID: MessageID.make("01HUSER0000000000000000099"),
                sessionID: created.id,
                type: "text",
                text: "并行完成多个模块的迁移和替换，先做计划、任务拆解、review，再统一验证。",
              },
            ],
          },
        })

        yield* session.setComposeRoute({ sessionID: created.id, composeRoute: route })
        const updated = yield* session.get(created.id)
        expect(updated.composeRoute?.sourceMessageID).toBe(route.sourceMessageID)
        expect(updated.composeRoute?.strategy).toBe("full-orchestration")
      }),
    ),
  )
})
