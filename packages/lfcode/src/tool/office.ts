import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./office.txt"
import { AppFileSystem } from "@/filesystem"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { installManagedOfficeCli, resolveOfficeCliCommand } from "@/runtime-registry/officecli"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const OFFICE_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"])

const Parameters = z.object({
  action: z.enum(["inspect", "query", "create", "edit", "render", "validate", "merge"]),
  file: z.string().describe("Document path. Relative paths resolve from the session working directory."),
  selector: z.string().optional().describe("OfficeCLI selector for query or edit operations."),
  operation: z
    .enum(["set", "add", "remove", "move", "swap", "batch"])
    .optional()
    .describe("Edit operation. Required for edit."),
  type: z.string().optional().describe("Element type for an add operation."),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Properties passed as repeated --prop key=value arguments."),
  destination: z
    .string()
    .optional()
    .describe("Destination selector for move or swap, or output document path for merge."),
  data: z.string().optional().describe("JSON object for merge or JSON command list for batch."),
  render: z
    .enum(["html", "screenshot", "svg", "pdf"])
    .optional()
    .describe("Render output for render. Defaults to html."),
  view: z
    .enum(["outline", "text", "annotated", "stats", "issues"])
    .optional()
    .describe("View mode for inspect. Defaults to outline."),
  timeout: z
    .number()
    .optional()
    .describe("Optional reminder threshold in milliseconds. It never terminates OfficeCLI."),
  description: z.string().describe("Clear, concise description of what this office operation does in 5-10 words."),
})

export const OfficeTool = Tool.define<typeof Parameters, Tool.Metadata, AppFileSystem.Service>(
  "office",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cwd = SessionCwd.get(ctx.sessionID)
          const file = normalizeDocumentPath(params.file, cwd)
          const destination =
            params.action === "merge" && params.destination ? normalizeDocumentPath(params.destination, cwd) : undefined
          const mutates = params.action === "create" || params.action === "edit" || params.action === "merge"

          if (params.action !== "create") {
            const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!info || info.type !== "File") throw new Error(`Office document was not found: ${file}`)
          }
          validateOfficeExtension(file)
          yield* assertExternalDirectoryEffect(ctx, file, { kind: "file" })
          if (destination) {
            validateOfficeExtension(destination)
            yield* assertExternalDirectoryEffect(ctx, destination, { kind: "file" })
          }

          const command = yield* resolveOfficeCli(ctx)
          const args = buildOfficeArgs(params, file, destination)
          yield* ctx.ask({
            permission: "shell",
            patterns: [command.path],
            always: ["*"],
            metadata: {
              command: [command.path, ...args],
              workdir: cwd,
              ...(mutates ? { writes: [destination ?? file] } : {}),
            },
          })

          const runtime = shellBackgroundRuntimeRef.current
          if (!runtime) throw new Error("Shell background runtime is not available in this process.")
          const job = yield* runtime.start({
            sessionID: ctx.sessionID,
            source: "officecli",
            title: params.description,
            cwd,
            env: Object.fromEntries(
              Object.entries({ ...process.env, OFFICECLI_SKIP_UPDATE: "1" }).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
            shell: "",
            shellName: "argv",
            argv: [command.path, ...args],
            ...(params.timeout !== undefined ? { remindAfterMs: params.timeout } : {}),
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })

          return {
            title: params.description,
            output: `Started tracked OfficeCLI shell process.\n<job_id>${job.id}</job_id>\n<status>${job.status}</status>\nCompletion is reported automatically; use shell_process only when inspection is needed. Only shell_process.cancel after an explicit user request can terminate it.`,
            metadata: {
              action: params.action,
              file,
              ...(destination ? { destination } : {}),
              command: command.path,
              source: command.source,
              jobID: job.id,
              status: job.status,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function normalizeDocumentPath(value: string, cwd: string) {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value)
}

function validateOfficeExtension(value: string) {
  const extension = path.extname(value).toLowerCase()
  if (OFFICE_EXTENSIONS.has(extension)) return
  throw new Error(`Office tool only supports .docx, .xlsx, and .pptx files: ${value}`)
}

const resolveOfficeCli = Effect.fn("OfficeTool.resolveOfficeCli")(function* (ctx: Tool.Context) {
  const existing = yield* Effect.promise(() => resolveOfficeCliCommand())
  if (existing) return existing
  yield* ctx.ask({
    permission: "shell",
    patterns: ["runtime:install:officecli"],
    always: ["*"],
    metadata: { command: "runtime install officecli", runtime_action: "install", runtime_id: "officecli" },
  })
  yield* Effect.promise(() => installManagedOfficeCli())
  const installed = yield* Effect.promise(() => resolveOfficeCliCommand())
  if (installed) return installed
  throw new Error("OfficeCLI installation completed but the executable could not be resolved.")
})

function buildOfficeArgs(params: z.infer<typeof Parameters>, file: string, destination?: string) {
  if (params.action === "create") return ["create", file, "--json"]
  if (params.action === "inspect") return ["view", file, params.view ?? "outline", "--json"]
  if (params.action === "query") {
    if (!params.selector) throw new Error("office query requires selector.")
    return ["query", file, params.selector, "--json"]
  }
  if (params.action === "render") return ["view", file, params.render ?? "html", "--json"]
  if (params.action === "validate") return ["validate", file, "--json"]
  if (params.action === "merge") {
    if (!destination || !params.data) throw new Error("office merge requires destination and data JSON.")
    return ["merge", file, destination, params.data, "--json"]
  }

  const operation = params.operation
  if (!operation) throw new Error("office edit requires operation.")
  if (operation === "batch") {
    if (!params.data) throw new Error("office batch requires data JSON commands.")
    return ["batch", file, "--commands", params.data, "--json"]
  }
  if (!params.selector) throw new Error(`office edit '${operation}' requires selector.`)
  if (operation === "remove") return ["remove", file, params.selector, "--json"]
  if (operation === "move") {
    if (!params.destination) throw new Error("office move requires destination selector.")
    return ["move", file, params.selector, "--to", params.destination, "--json"]
  }
  if (operation === "swap") {
    if (!params.destination) throw new Error("office swap requires destination selector.")
    return ["swap", file, params.selector, params.destination, "--json"]
  }
  if (operation === "add" && !params.type) throw new Error("office add requires type.")
  return [
    operation,
    file,
    params.selector,
    ...(operation === "add" ? ["--type", params.type!] : []),
    ...Object.entries(params.properties ?? {}).flatMap(([key, value]) => ["--prop", `${key}=${String(value)}`]),
    "--json",
  ]
}

function renderOfficeOutput(stdout: string, stderr: string, exit: number, timedOut: boolean, timeout: number) {
  const output = [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n\n" : "")
  if (timedOut)
    return output ? `${output}\n\nOfficeCLI timed out after ${timeout}ms.` : `OfficeCLI timed out after ${timeout}ms.`
  if (output) return output
  return exit === 0 ? "OfficeCLI completed with no output." : `OfficeCLI failed with exit code ${exit} and no output.`
}
