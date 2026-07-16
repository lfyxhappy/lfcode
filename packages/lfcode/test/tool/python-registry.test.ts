import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { ProviderID, ModelID } from "../../src/provider/schema"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, node))

describe("tool.registry python", () => {
  it.live(
    "includes python and pip in builtins",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const agents = yield* Agent.Service
          const general = yield* agents.get("general")
          if (!general) throw new Error("no general agent")
          const tools = yield* registry.tools({
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
            agent: general,
            capabilities: { patch_editing: false },
          })
          expect(tools.some((tool) => tool.id === "python")).toBe(true)
          expect(tools.some((tool) => tool.id === "pip")).toBe(true)
        }),
      ),
    30000,
  )
})
