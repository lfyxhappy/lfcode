import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"

import { Agent } from "../../src/agent/agent"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { PluginAuthorTool } from "../../src/tool/plugin_author"
import { Tool, Truncate } from "../../src/tool"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_plugin_author"),
  messageID: MessageID.make("msg_plugin_author"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(() => {
  delete process.env.LFCODE_PLUGIN_LIBRARY_DIR
})

describe("plugin_author", () => {
  test("creates, validates, previews, tests, and exports a restricted workspace", async () => {
    await using tmp = await tmpdir()
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = path.join(tmp.path, "library")
    const output = path.join(tmp.path, "demo.lfplugin.zip")
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const context: Tool.Context = {
      ...ctx,
      ask: (request) => Effect.sync(() => requests.push(request)),
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await runtime.runPromise(
          Effect.gen(function* () {
            return yield* Tool.init(yield* PluginAuthorTool)
          }),
        )
        await runtime.runPromise(
          tool.execute(
            {
              action: "create",
              id: "demo.author",
              category: "tool",
              name: "Author Demo",
              description: "Create author demo plugin workspace",
            },
            context,
          ),
        )

        const validated = await runtime.runPromise(
          tool.execute(
            {
              action: "validate",
              id: "demo.author",
              description: "Validate author demo plugin workspace",
            },
            context,
          ),
        )
        expect(JSON.parse(validated.output)).toMatchObject({
          id: "demo.author",
          category: "tool",
          source: { type: "generated" },
        })
        expect(await fs.readdir(path.join(tmp.path, "library", "previews")).catch(() => [])).toEqual([])

        const previewed = await runtime.runPromise(
          tool.execute(
            {
              action: "preview",
              id: "demo.author",
              description: "Preview author demo plugin workspace",
            },
            context,
          ),
        )
        expect(JSON.parse(previewed.output).token).toBeString()

        const tested = await runtime.runPromise(
          tool.execute(
            {
              action: "test",
              id: "demo.author",
              description: "Test author demo plugin workspace",
            },
            context,
          ),
        )
        expect(JSON.parse(tested.output).command).toBe("bun test")
        expect(requests).toContainEqual(
          expect.objectContaining({
            permission: "shell",
            patterns: ["bun test"],
            metadata: expect.objectContaining({ plugin_action: "test" }),
          }),
        )

        const exported = await runtime.runPromise(
          tool.execute(
            {
              action: "export",
              id: "demo.author",
              description: "Export author demo plugin workspace",
              output,
            },
            context,
          ),
        )
        expect(JSON.parse(exported.output)).toMatchObject({ file: output, files: 2 })
        expect(await Bun.file(output).exists()).toBe(true)
      },
    })
  })

  test("rejects plugin ids that escape the managed workspace", async () => {
    await using tmp = await tmpdir()
    process.env.LFCODE_PLUGIN_LIBRARY_DIR = path.join(tmp.path, "library")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await runtime.runPromise(
          Effect.gen(function* () {
            return yield* Tool.init(yield* PluginAuthorTool)
          }),
        )

        await expect(
          runtime.runPromise(
            tool.execute(
              {
                action: "create",
                id: "../escape",
                category: "tool",
                name: "Escape",
                description: "Reject escaped plugin workspace path",
              },
              ctx,
            ),
          ),
        ).rejects.toThrow("Invalid plugin id")
      },
    })
  })
})
