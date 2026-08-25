import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { McpManageTool } from "../../src/tool/mcp_manage"
import { ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.mcp_manage", () => {
  it.live("saves, toggles, lists, and removes MCP configuration through the registry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.tools({
          providerID: "lfcode" as never,
          modelID: "gpt-5" as never,
          agent: { name: "build", mode: "primary", permission: [], options: {}, toolAllowlist: [McpManageTool.id] },
        })).find((item) => item.id === McpManageTool.id)
        if (!tool) throw new Error("mcp_manage tool not found")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          sessionID: SessionID.make("ses_mcp_manage"),
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: (request) => Effect.sync(() => requests.push(request)),
        }

        const saved = yield* tool.execute(
          {
            action: "save",
            name: "managed-mcp",
            config: { type: "local", command: [process.execPath, "--version"] },
            reason: "Save a managed MCP for this test",
          },
          ctx,
        )
        expect(saved.output).toContain("managed-mcp")
        expect(requests[0]?.permission).toBe("edit")

        const disabled = yield* tool.execute(
          { action: "disable", name: "managed-mcp", reason: "Disable the managed MCP for this test" },
          ctx,
        )
        expect(disabled.output).toContain('"enabled": false')

        const listed = yield* tool.execute({ action: "list", reason: "Inspect managed MCP configuration" }, ctx)
        expect(listed.output).toContain("managed-mcp")
        expect(listed.output).toContain('"enabled": false')

        const removed = yield* tool.execute(
          { action: "remove", name: "managed-mcp", reason: "Remove the managed MCP after this test" },
          ctx,
        )
        expect(removed.output).toContain("managed-mcp")
      }),
    ),
  )
})
