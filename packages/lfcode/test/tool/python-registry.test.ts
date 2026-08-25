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

describe("tool.registry runtime tools", () => {
  it.live(
    "keeps direct runtime tools out of the default model toolset",
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
          expect(tools.some((tool) => tool.id === "python")).toBe(false)
          expect(tools.some((tool) => tool.id === "pip")).toBe(false)
          expect(tools.some((tool) => tool.id === "cpp")).toBe(false)
          expect(tools.some((tool) => tool.id === "runtime_manage")).toBe(false)
          expect(tools.some((tool) => tool.id === "office")).toBe(false)
        }),
      ),
    30000,
  )
})
