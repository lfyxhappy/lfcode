import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { ProviderID, ModelID } from "../../src/provider/schema"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, node))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  it.live("loads tools from .lfcode/tool (singular)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lfcode = path.join(dir, ".lfcode")
        const tool = path.join(lfcode, "tool")
        yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tool, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools from .lfcode/tools (plural)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lfcode = path.join(dir, ".lfcode")
        const tools = path.join(lfcode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools with external dependencies without crashing", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lfcode = path.join(dir, ".lfcode")
        const tools = path.join(lfcode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(lfcode, "package.json"),
            JSON.stringify({
              name: "custom-tools",
              dependencies: {
                "@lfcode-ai/plugin": "^0.0.0",
                cowsay: "^1.6.0",
              },
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(lfcode, "package-lock.json"),
            JSON.stringify({
              name: "custom-tools",
              lockfileVersion: 3,
              packages: {
                "": {
                  dependencies: {
                    "@lfcode-ai/plugin": "^0.0.0",
                    cowsay: "^1.6.0",
                  },
                },
              },
            }),
          ),
        )

        const cowsay = path.join(lfcode, "node_modules", "cowsay")
        yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "package.json"),
            JSON.stringify({
              name: "cowsay",
              type: "module",
              exports: "./index.js",
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "index.js"),
            ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "cowsay.ts"),
            [
              "import { say } from 'cowsay'",
              "export default {",
              "  description: 'tool that imports cowsay at top level',",
              "  args: { text: { type: 'string' } },",
              "  execute: async ({ text }: { text: string }) => {",
              "    return say({ text })",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("cowsay")
      }),
    ),
  )

  it.live("todowrite tool is not registered; task is", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).not.toContain("todowrite")
        expect(ids).not.toContain("todo")
        expect(ids).toContain("task")
      }),
    ),
  )

  it.live("xiaomi token plan providers expose websearch", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("xiaomi-token-plan-cn"),
          modelID: ModelID.make("mimo-v2.5-pro"),
          agent: general,
        })

        expect(tools.find((tool) => tool.id === "websearch")).toBeDefined()
      }),
    ),
  )
})
