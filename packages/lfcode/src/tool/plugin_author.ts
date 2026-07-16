import { mkdir, readdir, stat, writeFile } from "fs/promises"
import path from "path"
import z from "zod"
import { Effect } from "effect"

import { authorWorkspace, discardImportPreview, exportAuthorWorkspace, previewGeneratedImport } from "@/plugin/library"
import { Filesystem } from "@/util"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["create", "inspect", "validate", "test", "preview", "export"]),
  id: z.string(),
  category: z.enum(["tool", "integration"]).optional(),
  name: z.string().optional(),
  description: z.string().describe("Clear description of the authoring operation in 5-10 words."),
  output: z.string().optional(),
})

export const PluginAuthorTool = Tool.define(
  "plugin_author",
  Effect.succeed({
    description:
      "Create and validate tool or integration plugins inside a restricted managed authoring workspace. Preview never installs; use plugin_manage import_commit only after user confirmation.",
    parameters: Parameters,
    execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const workspace = authorWorkspace(params.id)
        if (params.action === "create") {
          if (!params.category || !params.name) throw new Error("plugin_author create requires category and name")
          yield* ctx.ask({
            permission: "edit",
            patterns: [`plugin-workspace:${params.id}`],
            always: [],
            metadata: { plugin_action: "create", plugin_id: params.id, category: params.category },
          })
          if (yield* Effect.promise(() => Filesystem.exists(workspace)))
            throw new Error(`Plugin workspace already exists: ${params.id}`)
          yield* Effect.promise(() =>
            createWorkspace(workspace, params.id, params.name!, params.category!, params.description),
          )
          return output(params.description, { id: params.id, workspace, category: params.category })
        }
        if (!(yield* Effect.promise(() => Filesystem.isDir(workspace))))
          throw new Error(`Plugin workspace not found: ${params.id}`)
        if (params.action === "inspect")
          return output(params.description, yield* Effect.promise(() => inspectWorkspace(workspace)))
        if (params.action === "validate") {
          const report = yield* Effect.promise(async () => {
            const preview = await previewGeneratedImport({ directory: workspace })
            try {
              return preview.report
            } finally {
              await discardImportPreview(preview.token)
            }
          })
          return output(params.description, report)
        }
        if (params.action === "test") {
          yield* ctx.ask({
            permission: "shell",
            patterns: ["bun test"],
            always: [],
            metadata: { plugin_action: "test", plugin_id: params.id, workspace },
          })
          const result = yield* Effect.promise(() => runWorkspaceTest(workspace, ctx.abort))
          return output(params.description, result)
        }
        if (params.action === "preview") {
          const preview = yield* Effect.promise(() => previewGeneratedImport({ directory: workspace }))
          return output(params.description, preview)
        }
        if (!params.output) throw new Error("plugin_author export requires output")
        yield* ctx.ask({
          permission: "edit",
          patterns: [`plugin-export:${params.output}`],
          always: [],
          metadata: { plugin_action: "export", plugin_id: params.id, output: params.output },
        })
        const exported = yield* Effect.promise(() => exportAuthorWorkspace(params.id, path.resolve(params.output!)))
        return output(params.description, exported)
      }).pipe(Effect.orDie),
  }),
)

async function createWorkspace(
  workspace: string,
  id: string,
  name: string,
  category: "tool" | "integration",
  description: string,
) {
  await mkdir(workspace, { recursive: true })
  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify(
      {
        name: id,
        version: "0.1.0",
        type: "module",
        lfcode: {
          apiVersion: 2,
          id,
          name,
          version: "0.1.0",
          description,
          category,
          capabilities: category === "tool" ? ["tool"] : ["integration"],
          entrypoints: { location: "./index.ts" },
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    path.join(workspace, "index.ts"),
    category === "tool"
      ? 'import { defineServerPlugin, tool } from "@lfcode-ai/plugin"\n\nexport default defineServerPlugin({\n  id: "' +
          id +
          '",\n  server: async () => ({\n    tool: {\n      hello: tool({\n        description: "Describe this tool",\n        args: {},\n        execute: async () => "Replace this implementation",\n      }),\n    },\n  }),\n})\n'
      : 'import { defineServerPlugin } from "@lfcode-ai/plugin"\n\nexport default defineServerPlugin({\n  id: "' +
          id +
          '",\n  server: async () => ({}),\n})\n',
  )
}

async function runWorkspaceTest(workspace: string, abort: AbortSignal) {
  const command = ["bun", "test"]
  const child = Bun.spawn(command, {
    cwd: workspace,
    env: testEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.any([abort, AbortSignal.timeout(120_000)]),
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { command: command.join(" "), exitCode, stdout, stderr }
}

function testEnvironment() {
  return Object.fromEntries(
    ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "BUN_INSTALL"]
      .map((key) => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
  )
}

async function inspectWorkspace(workspace: string) {
  const files = await readdir(workspace)
  return Promise.all(files.sort().map(async (name) => ({ name, bytes: (await stat(path.join(workspace, name))).size })))
}

function output(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
