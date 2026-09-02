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
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")
        const visible = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        expect(visible.find((item) => item.id === "search_tool")).toBeDefined()
        expect(visible.find((item) => item.id === "use_tool")).toBeDefined()
        expect(visible.find((item) => item.id === "hello")).toBeUndefined()
        expect(visible.find((item) => item.id === "read")?.metadata).toMatchObject({
          kind: "file",
          namespace: "file",
          readOnly: true,
        })
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

  it.live("registers only the canonical base tool surface", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        for (const id of [
          "read", "search", "edit", "shell", "shell_process", "browser", "app_control", "webfetch", "websearch",
          "skill", "memory", "task", "actor", "question", "create_goal", "get_goal", "update_goal",
        ]) expect(ids).toContain(id)
        for (const id of [
          "todowrite", "todo", "multiedit", "write", "apply_patch", "replace_range", "symbol_edit",
          "glob", "grep", "bash", "cpp", "runtime_manage", "file_info", "tree",
          "archive_inspect", "edit_history", "app_open_browser", "app_browser_snapshot",
        ]) expect(ids).not.toContain(id)
      }),
    ),
  )

  it.live("all models expose edit as the only public file-editing tool", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        if (!general) throw new Error("no general agent")

        const patchTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
          capabilities: { patch_editing: true },
        })
        const legacyTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
          capabilities: { patch_editing: false },
        })

        for (const tools of [patchTools, legacyTools]) {
          expect(tools.find((tool) => tool.id === "edit")).toBeDefined()
          expect(tools.find((tool) => tool.id === "shell_process")).toBeDefined()
          expect(tools.find((tool) => tool.id === "search")).toBeDefined()
          expect(tools.find((tool) => tool.id === "apply_patch")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "replace_range")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "symbol_edit")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "write")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "background_job")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "glob")).toBeUndefined()
          expect(tools.find((tool) => tool.id === "grep")).toBeUndefined()
        }

      }),
    ),
  )

  it.live("exposes actor dispatch to the primary agent but not a subagent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const general = yield* agents.get("general")
        const build = yield* agents.get("build")
        if (!general) throw new Error("no general agent")
        if (!build) throw new Error("no build agent")

        const subagentTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: general,
        })
        const primaryTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build,
        })
        expect(subagentTools.find((tool) => tool.id === "actor")).toBeUndefined()
        expect(primaryTools.find((tool) => tool.id === "actor")).toBeDefined()
      }),
    ),
  )

  it.live("keeps browser verification tools visible for narrow read-only agents", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const explore = yield* agents.get("explore")
        if (!explore) throw new Error("no explore agent")

        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: explore,
        })
        const ids = new Set(tools.map((tool) => tool.id))
        expect(ids.has("browser")).toBe(true)
        expect(ids.has("app_open_browser")).toBe(false)
        expect(ids.has("app_browser_snapshot")).toBe(false)
      }),
    ),
  )

  it.live("does not reintroduce removed tools through agent allowlists", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build")
        if (!build) throw new Error("no build agent")

        const normal = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build,
        })
        const normalIDs = new Set(normal.map((tool) => tool.id))
        for (const id of ["read", "search", "edit", "shell", "task", "question"]) {
          expect(normalIDs.has(id)).toBe(true)
        }
        for (const id of [
          "plugin_author",
          "plugin_manage",
          "skill_manage",
          "hook_manage",
          "mcp_manage",
          "provider_manage",
          "credential_manage",
          "context_broker",
          "capability_manage",
        ]) {
          expect(normalIDs.has(id)).toBe(false)
        }

        const restricted = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: {
            ...build,
            name: "removed-tool-fixture",
            toolAllowlist: ["write", "apply_patch", "bash"],
          },
        })
        const restrictedIDs = new Set(restricted.map((tool) => tool.id))
        expect(restrictedIDs.has("write")).toBe(false)
        expect(restrictedIDs.has("apply_patch")).toBe(false)
        expect(restrictedIDs.has("bash")).toBe(false)
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
