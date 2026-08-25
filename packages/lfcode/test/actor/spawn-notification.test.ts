import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider"
import { Env } from "../../src/env"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { AppFileSystem } from "@/filesystem"
import { SessionPrune } from "../../src/session/prune"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { Goal } from "../../src/session/goal"
import { TaskGateState } from "../../src/task/gate-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool"
import { Truncate } from "../../src/tool"
import { ActorRegistry } from "../../src/actor/registry"
import { ActorWaiter } from "../../src/actor/waiter"
import { Actor } from "../../src/actor/spawn"
import { Memory } from "../../src/memory"
import { History } from "../../src/history"
import { Team } from "../../src/team"
import { SessionCheckpoint } from "../../src/session/checkpoint"
import { SessionCompaction } from "../../src/session/compaction"
import { TaskRegistry } from "../../src/task/registry"
import { Auth } from "../../src/auth"
import { Database } from "../../src/storage"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"
import { Inbox } from "../../src/inbox"
import { InboxTable } from "../../src/inbox/inbox.sql"
import { ContextReviewTable } from "../../src/context-review/context-review.sql"

afterEach(async () => {
  await Instance.disposeAll()
})

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in spawn-notification tests"),
    authenticate: () => Effect.die("unexpected MCP auth in spawn-notification tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in spawn-notification tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    syncFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    completion: () => Effect.succeed(undefined),
    signatureHelp: () => Effect.succeed(undefined),
    prepareRename: () => Effect.succeed(undefined),
    rename: () => Effect.succeed(undefined),
    formatting: () => Effect.succeed([]),
    rangeFormatting: () => Effect.succeed([]),
    codeAction: () => Effect.succeed([]),
    executeCommand: () => Effect.succeed(undefined),
    declaration: () => Effect.succeed([]),
    definition: () => Effect.succeed([]),
    typeDefinition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentHighlights: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeLayer() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const checkpoint = SessionCheckpoint.defaultLayer
  const taskRegistry = ActorRegistry.defaultLayer
  const taskWaiter = ActorWaiter.defaultLayer
  const team = Team.defaultLayer
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Goal.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(taskRegistry),
    Layer.provide(taskWaiter),
    Layer.provide(team),
    Layer.provide(checkpoint),
    Layer.provide(Memory.defaultLayer),
    Layer.provide(History.defaultLayer),
    Layer.provide(TaskRegistry.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Layer.mergeAll(Instruction.defaultLayer, Bus.layer)),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
    Layer.provide(
      Layer.mergeAll(
        Goal.defaultLayer,
        ProviderSvc.defaultLayer,
        Session.defaultLayer,
        Truncate.defaultLayer,
        AgentSvc.defaultLayer,
      ),
    ),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
  const prune = SessionPrune.layer.pipe(Layer.provide(checkpoint), Layer.provideMerge(deps))
  const prompt = SessionPrompt.layer.pipe(
    Layer.provide(Goal.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(TaskGateState.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(summary),
    Layer.provide(checkpoint),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(team),
    Layer.provide(taskRegistry),
    Layer.provideMerge(run),
    Layer.provideMerge(prune),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(Inbox.defaultLayer),
    Layer.provideMerge(deps),
  )
  const inboxLayer = Inbox.defaultLayer
  return Layer.mergeAll(
    TestLLMServer.layer,
    Actor.layer.pipe(
      Layer.provideMerge(prompt),
      Layer.provideMerge(taskRegistry),
      Layer.provide(TaskRegistry.defaultLayer),
      Layer.provide(inboxLayer),
    ),
  ).pipe(
    Layer.provide(summary),
    Layer.provide(Goal.defaultLayer),
    Layer.provide(ProviderSvc.defaultLayer),
    Layer.provide(Session.defaultLayer),
  )
}

const it = testEffect(makeLayer())

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

describe("Actor.spawn inbox notifications (Plan 3 / Task 2)", () => {
  it.live("background subagent completion writes actor_notification to parent main inbox", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const actor = yield* Actor.Service
        const session = yield* Session.Service

        const parent = yield* session.create({
          title: "notification-test-bg-subagent",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Let the LLM respond immediately so forkWork.onSuccess fires.
        yield* llm.text("**Status**: success\n**Summary**: done")

        const result = yield* actor.spawn({
          mode: "subagent",
          sessionID: parent.id,
          agentType: "build",
          task: "write a hello world file",
          description: "background build task",
          context: "none",
          tools: ["read"],
          background: true,
          model: ref,
        })

        // Wait for the forked fiber to complete.
        yield* Deferred.await(result.outcome)

        // Query inbox table directly: expect 1 row delivered to main actor.
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(InboxTable)
              .where(
                and(
                  eq(InboxTable.receiver_session_id, parent.id),
                  eq(InboxTable.receiver_actor_id, "main"),
                ),
              )
              .all(),
          ),
        )

        expect(rows.length).toBe(1)
        expect(rows[0].type).toBe("completion_notification")
        const content = rows[0].content as { text?: string }
        expect(content.text).toContain('"source":"actor"')
        expect(content.text).toContain('"summary":"done"')
        expect(content.text).toContain("completed")
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("checkpoint-writer agentType does not write inbox notification", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const actor = yield* Actor.Service
        const session = yield* Session.Service

        const parent = yield* session.create({
          title: "notification-test-ckpt-writer",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Auto-respond so the actor completes without hanging.
        yield* llm.text("checkpoint output")

        const result = yield* actor.spawn({
          mode: "subagent",
          sessionID: parent.id,
          agentType: "checkpoint-writer",
          task: "write checkpoint",
          context: "none",
          tools: ["read"],
          background: true,
          model: ref,
        })

        yield* Deferred.await(result.outcome)

        // Inbox table must be empty — checkpoint-writer is gated out.
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(InboxTable)
              .where(eq(InboxTable.receiver_session_id, parent.id))
              .all(),
          ),
        )

        expect(rows.length).toBe(0)
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("context-reviewer agentType does not write inbox notification", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const actor = yield* Actor.Service
        const session = yield* Session.Service

        const parent = yield* session.create({
          title: "notification-test-context-reviewer",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text('{"skills":[],"memory":[]}')
        const result = yield* actor.spawn({
          mode: "subagent",
          sessionID: parent.id,
          agentType: "context-reviewer",
          task: "review the completed turn",
          context: "none",
          tools: ["memory"],
          background: true,
          model: ref,
        })

        yield* Deferred.await(result.outcome)
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(InboxTable).where(eq(InboxTable.receiver_session_id, parent.id)).all(),
          ),
        )
        expect(rows.length).toBe(0)
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("a completed hidden review hands off only to the immediately following main turn", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service
        const parent = yield* session.create({
          title: "context-review-handoff",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("The first answer omitted the code review workflow.")
        yield* llm.push(
          reply().tool("StructuredOutput", {
            skills: [
              { name: "code-reviewer" },
              { name: "removed-skill" },
            ],
            memory: [{ query: "code review preference" }],
          }),
        )
        const first = yield* prompt.prompt({
          sessionID: parent.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "Can you review this change?" }],
        })
        expect(first.info.role).toBe("assistant")

        const completed = yield* Effect.gen(function* () {
          let lastReview: { status: string; error: string | null } | undefined
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const review = Database.use((db) =>
              db.select().from(ContextReviewTable).where(eq(ContextReviewTable.session_id, parent.id)).get(),
            )
            if (review?.status === "completed") return review
            lastReview = review ? { status: review.status, error: review.error } : undefined
            yield* Effect.sleep("25 millis")
          }
          const inputs = yield* llm.inputs
          return yield* Effect.die(
            new Error(
              `context reviewer did not complete: ${JSON.stringify(lastReview)}; inputs=${JSON.stringify(
                inputs.map((input) => ({
                  last: Array.isArray(input.messages) ? input.messages.at(-1) : undefined,
                  toolNames: Array.isArray(input.tools)
                    ? input.tools.map((tool) => {
                        if (!tool || typeof tool !== "object" || !("function" in tool)) return
                        const fn = tool.function
                        return fn && typeof fn === "object" && "name" in fn ? fn.name : undefined
                      })
                    : undefined,
                })),
              )}`,
            ),
          )
        })
        expect(completed.findings).toEqual({
          skills: [
            { name: "code-reviewer" },
            { name: "removed-skill" },
          ],
          memory: [{ query: "code review preference" }],
        })

        yield* llm.text("The automation completed without changing the review.")
        const automation = yield* prompt.prompt({
          sessionID: parent.id,
          agent: "build",
          model: ref,
          source: "automation",
          parts: [{ type: "text", text: "Run scheduled maintenance." }],
        })
        expect(automation.info.role).toBe("assistant")
        const afterAutomation = Database.use((db) =>
          db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, completed.id)).get(),
        )
        expect(afterAutomation?.status).toBe("completed")

        yield* llm.text("The related review follow-up answer.")
        const second = yield* prompt.prompt({
          sessionID: parent.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "Please continue reviewing it." }],
        })
        expect(second.info.role).toBe("assistant")

        const inputs = yield* llm.inputs
        const toolNames = (input: (typeof inputs)[number] | undefined) =>
          (Array.isArray(input?.tools) ? input.tools : []).flatMap((tool: unknown) => {
            if (!tool || typeof tool !== "object" || !("function" in tool)) return []
            const fn = tool.function
            return fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string" ? [fn.name] : []
          }) ?? []
        const firstTurn = inputs.find((input) => JSON.stringify(input).includes("Can you review this change?"))
        // The first turn has no completed review yet. Memory must remain
        // unavailable until an explicit user request or a valid hand-off.
        expect(toolNames(firstTurn)).not.toContain("memory")
        const secondTurn = inputs.find((input) => JSON.stringify(input).includes("Please continue reviewing it."))
        expect(JSON.stringify(secondTurn)).toContain("<context_review")
        expect(JSON.stringify(secondTurn)).toContain("code-reviewer")
        expect(JSON.stringify(secondTurn)).not.toContain("removed-skill")
        expect(JSON.stringify(secondTurn)).toContain("code review preference")
        // Code Mode no longer adds a duplicate run_code facade; the complete
        // native catalog is injected directly for every presentation mode.
        expect(toolNames(secondTurn)).not.toContain("run_code")

        const consumed = Database.use((db) =>
          db.select().from(ContextReviewTable).where(eq(ContextReviewTable.id, completed.id)).get(),
        )
        expect(consumed?.status).toBe("consumed")
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("does not review an automation turn", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service
        const parent = yield* session.create({
          title: "context-review-automation-excluded",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("The scheduled automation completed.")
        const response = yield* prompt.prompt({
          sessionID: parent.id,
          agent: "build",
          model: ref,
          source: "automation",
          parts: [{ type: "text", text: "Run the scheduled maintenance check." }],
        })
        expect(response.info.role).toBe("assistant")

        // Scheduling creates its database record before the reviewer calls a
        // model, so a short yield is sufficient to detect an accidental run.
        yield* Effect.sleep("50 millis")
        const reviews = Database.use((db) =>
          db.select().from(ContextReviewTable).where(eq(ContextReviewTable.session_id, parent.id)).all(),
        )
        expect(reviews).toHaveLength(0)
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("foreground spawn does not write inbox notification", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const actor = yield* Actor.Service
        const session = yield* Session.Service

        const parent = yield* session.create({
          title: "notification-test-fg",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Auto-respond so the foreground spawn completes.
        yield* llm.text("**Status**: success\n**Summary**: done")

        // background: false — foreground spawn, caller awaits via Fiber.join.
        const result = yield* actor.spawn({
          mode: "subagent",
          sessionID: parent.id,
          agentType: "build",
          task: "check something",
          description: "foreground build task",
          context: "none",
          tools: ["read"],
          background: false,
          model: ref,
        })

        // Foreground spawn: Fiber.join already awaited inside spawnSubagent.
        // outcome Deferred is also resolved; await it for safety.
        yield* Deferred.await(result.outcome)

        // No inbox row should exist — foreground path skips inbox.send.
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(InboxTable)
              .where(eq(InboxTable.receiver_session_id, parent.id))
              .all(),
          ),
        )

        expect(rows.length).toBe(0)
      }),
      { git: true, config: providerCfg },
    ),
  )
})

