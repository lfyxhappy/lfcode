import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

it.live("registers managed plugin authoring tools", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("plugin_author")
      expect(ids).toContain("plugin_manage")
    }),
  ),
)
