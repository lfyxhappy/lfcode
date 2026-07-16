import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer))

describe("tool.registry compose workflow exposure", () => {
  test("compose sees workflow without experimental flag", async () => {
    await provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const compose = yield* agents.get("compose")
        if (!compose) throw new Error("missing compose agent")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: compose,
        })

        expect(tools.find((tool) => tool.id === "workflow")).toBeDefined()
      }),
    )
  })

  test("build keeps workflow hidden without experimental flag", async () => {
    await provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build")
        if (!build) throw new Error("missing build agent")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build,
        })

        expect(tools.find((tool) => tool.id === "workflow")).toBeUndefined()
      }),
    )
  })
})
