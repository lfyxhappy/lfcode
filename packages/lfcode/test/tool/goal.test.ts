import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Goal } from "../../src/session/goal"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Tool } from "../../src/tool"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    ToolRegistry.defaultLayer.pipe(Layer.provide(Goal.defaultLayer)),
    Session.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("goal tools", () => {
  it.live("registry exposes goal tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("create_goal")
        expect(ids).toContain("get_goal")
        expect(ids).toContain("update_goal")
      }),
    ),
  )

  it.live("create_goal, get_goal, and blocked update operate on the current session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const session = yield* Session.Service
        const info = yield* session.create()
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tools = yield* registry.tools({
          providerID: "lfcode" as any,
          modelID: "gpt-5" as any,
          agent,
        })
        const createGoal = tools.find((tool) => tool.id === "create_goal")
        const getGoal = tools.find((tool) => tool.id === "get_goal")
        const updateGoal = tools.find((tool) => tool.id === "update_goal")
        if (!createGoal || !getGoal || !updateGoal) throw new Error("goal tools not found")

        const ctx: Tool.Context = {
          ...baseCtx,
          sessionID: info.id,
          messages: [
            {
              info: {
                id: MessageID.make("usr_goal"),
                sessionID: info.id,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: { providerID: "lfcode" as any, modelID: "gpt-5" as any },
              },
              parts: [{ type: "text", text: "进入 goal 模式，继续做直到完成发布清单" } as any],
            } as any,
          ],
          ask: () => Effect.void,
        }

        const created = yield* createGoal.execute({ objective: "Finish the release checklist" }, ctx)
        expect(created.output).toContain("Status: active")

        const current = yield* getGoal.execute({}, ctx)
        expect(current.output).toContain("Objective: Finish the release checklist")

        const first = yield* updateGoal.execute({ status: "blocked", reason: "network down" }, ctx)
        const second = yield* updateGoal.execute({ status: "blocked", reason: "network down" }, ctx)
        const third = yield* updateGoal.execute({ status: "blocked", reason: "network down" }, ctx)

        expect(first.output).toContain("remaining: 2")
        expect(second.output).toContain("remaining: 1")
        expect(third.output).toContain("Goal marked blocked")
      }),
    ),
  )

  it.live("update_goal refuses paused goals because getActive only recognizes active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const session = yield* Session.Service
        const info = yield* session.create()
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tools = yield* registry.tools({
          providerID: "lfcode" as any,
          modelID: "gpt-5" as any,
          agent,
        })
        const createGoal = tools.find((tool) => tool.id === "create_goal")
        const updateGoal = tools.find((tool) => tool.id === "update_goal")
        if (!createGoal || !updateGoal) throw new Error("goal tools not found")

        const ctx: Tool.Context = {
          ...baseCtx,
          sessionID: info.id,
          messages: [
            {
              info: {
                id: MessageID.make("usr_pause"),
                sessionID: info.id,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: { providerID: "lfcode" as any, modelID: "gpt-5" as any },
              },
              parts: [{ type: "text", text: "set a goal and keep working until it is done" } as any],
            } as any,
          ],
          ask: () => Effect.void,
        }

        const created = yield* createGoal.execute({ objective: "Pause me" }, ctx)
        yield* session.setGoal({
          sessionID: info.id,
          goal: {
            ...created.metadata.goal,
            status: "paused",
            stats: {
              ...created.metadata.goal.stats,
              activeSince: undefined,
              pausedAt: created.metadata.goal.time.updated,
            },
          },
        })
        const blocked = yield* updateGoal.execute({ status: "blocked", reason: "still waiting" }, ctx)
        expect(blocked.output).toContain("No active session goal is available to update.")
      }),
    ),
  )

  it.live("create_goal rejects ordinary requests that do not explicitly ask for goal mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const session = yield* Session.Service
        const info = yield* session.create()
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tools = yield* registry.tools({
          providerID: "lfcode" as any,
          modelID: "gpt-5" as any,
          agent,
        })
        const createGoal = tools.find((tool) => tool.id === "create_goal")
        if (!createGoal) throw new Error("create_goal not found")

        const ctx: Tool.Context = {
          ...baseCtx,
          sessionID: info.id,
          messages: [
            {
              info: {
                id: MessageID.make("usr_plain"),
                sessionID: info.id,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: { providerID: "lfcode" as any, modelID: "gpt-5" as any },
              },
              parts: [{ type: "text", text: "顺手把发布清单做一下" } as any],
            } as any,
          ],
          ask: () => Effect.void,
        }

        const result = yield* createGoal.execute({ objective: "Finish the release checklist" }, ctx)
        expect(result.title).toBe("Goal creation rejected")
        const current = yield* session.get(info.id)
        expect(current.goal).toBeUndefined()
      }),
    ),
  )
})
