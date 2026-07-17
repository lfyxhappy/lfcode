import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"

import { Agent } from "../../src/agent/agent"
import type { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool, Truncate } from "../../src/tool"
import { PluginManageTool } from "../../src/tool/plugin_manage"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

afterEach(() => {
  delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
})

describe("plugin_manage", () => {
  test("previews without mutation and requires permission before commit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await Bun.write(
          path.join(plugin, "package.json"),
          JSON.stringify({
            name: "managed-tool-test",
            version: "1.0.0",
            lfcode: {
              apiVersion: 2,
              id: "managed.tool.test",
              name: "Managed Tool Test",
              version: "1.0.0",
              category: "tool",
              capabilities: ["tool"],
              entrypoints: { location: "./index.ts" },
            },
          }),
        )
        await Bun.write(
          path.join(plugin, "index.ts"),
          "export default { id: 'managed.tool.test', server: async () => ({}) }",
        )
        return { plugin }
      },
    })
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = path.join(tmp.path, "library")
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      sessionID: SessionID.make("ses_plugin_manage"),
      messageID: MessageID.make("msg_plugin_manage"),
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: () => Effect.void,
      ask: (request) => Effect.sync(() => requests.push(request)),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await runtime.runPromise(
          Effect.gen(function* () {
            return yield* Tool.init(yield* PluginManageTool)
          }),
        )
        expect("force" in tool.parameters.shape).toBe(false)

        const previewed = await runtime.runPromise(
          tool.execute(
            {
              action: "import_preview",
              source: "directory",
              path: tmp.extra.plugin,
              description: "Preview managed plugin directory import",
            },
            ctx,
          ),
        )
        const preview = JSON.parse(previewed.output)
        expect(preview.report.operation).toBe("install")
        expect(requests).toHaveLength(0)

        const before = await runtime.runPromise(
          tool.execute(
            {
              action: "list",
            },
            ctx,
          ),
        )
        expect(JSON.parse(before.output)).toEqual([])

        await runtime.runPromise(
          tool.execute(
            {
              action: "import_commit",
              token: preview.token,
              description: "Commit reviewed managed plugin import",
            },
            ctx,
          ),
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({
          patterns: [`plugin:import_commit:${preview.report.id}:${preview.report.source.digest.slice(0, 12)}`],
          metadata: {
            plugin_action: "import_commit",
            plugin_id: preview.report.id,
            plugin_source: "directory",
            plugin_digest: preview.report.source.digest,
          },
        })
      },
    })
  })
})
