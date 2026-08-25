import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { CapabilityPersistence } from "../../src/capability/persistence"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { TaskRegistry } from "../../src/task/registry"
import { ContextBrokerTool } from "../../src/tool/context_broker"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.context_broker", () => {
  it.live("returns session history, tasks, and durable jobs through one audited read", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Effect.promise(() => AppRuntime.runPromise(Session.Service.use((service) => service.create({ title: "context broker" }))))
        yield* Effect.promise(() =>
          AppRuntime.runPromise(TaskRegistry.Service.use((service) => service.create({ session_id: session.id, summary: "Inspect Agent OS context" }))),
        )
        BackgroundJobPersistence.recordStart({
          id: "context-broker-job",
          sessionID: session.id,
          kind: "shell",
          source: "test",
          title: "Context Broker fixture",
          cwd: Instance.directory,
          payload: { command: "echo context", api_key: "context-broker-secret" },
          env: { CONTEXT_BROKER_TOKEN: "context-broker-secret" },
        })

        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.tools({
          providerID: "lfcode" as never,
          modelID: "gpt-5" as never,
          agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [ContextBrokerTool.id] },
        })).find((item) => item.id === ContextBrokerTool.id)
        if (!tool) throw new Error("context_broker tool not found")
        const ctx: Tool.Context = {
          sessionID: session.id,
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: (_request: Omit<Permission.Request, "id" | "sessionID" | "tool">) => Effect.void,
        }
        const result = yield* tool.execute(
          { action: "session", session_id: session.id, reason: "Inspect the current session context" },
          ctx,
        )
        expect(result.output).toContain("Inspect Agent OS context")
        expect(result.output).toContain("context-broker-job")
        expect(result.output).not.toContain("context-broker-secret")
        expect(result.output).not.toContain("CONTEXT_BROKER_TOKEN")
        expect(CapabilityPersistence.listAudit({ capability: "context_read" })).toContainEqual(
          expect.objectContaining({ reason: "Inspect the current session context", rollback: expect.objectContaining({ jobs: ["context-broker-job"] }) }),
        )
      }),
    ),
  )
})
