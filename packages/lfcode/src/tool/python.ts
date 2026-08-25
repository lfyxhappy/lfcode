import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./python.txt"
import { AppFileSystem } from "@/filesystem"
import { ensureManagedPythonCommand } from "@/python/environment"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"
import { formatPythonCommand } from "@/python/runtime"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import * as PatchRecovery from "./patch-recovery"

const MODULE_NOT_FOUND = /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i

const Parameters = z.object({
  code: z.string().describe("The Python code to execute."),
  args: z.array(z.string()).optional().describe("Optional CLI args exposed to the script as sys.argv[1:]."),
  timeout: z
    .number()
    .optional()
    .describe("Optional reminder threshold in milliseconds. It never terminates the script."),
  workdir: z.string().optional().describe("Optional working directory. Defaults to the current session directory."),
  description: z.string().describe("Clear, concise description of what the script does in 5-10 words."),
})

function renderOutput(input: { stdout: string; stderr: string; exit: number; timeout: number; timedOut: boolean }) {
  const sections = [input.stdout, input.stderr].filter(Boolean)
  const output = sections.join(sections.length === 2 ? "\n\n" : "")
  if (!output && input.exit === 0) return "Python script completed with no output."
  if (!output && input.exit !== 0 && !input.timedOut) {
    return `Python script failed with exit code ${input.exit} and no output.`
  }
  if (!input.timedOut) return output
  const timeoutLine = `Python script timed out after ${input.timeout}ms.`
  return output ? `${output}\n\n${timeoutLine}` : timeoutLine
}

function renderDependencyHint(stderr: string) {
  const match = stderr.match(MODULE_NOT_FOUND)
  if (!match) return
  return `Missing dependency detected: install Python package '${match[1]}' with the pip tool before retrying this script.`
}

export const PythonTool = Tool.define(
  "python",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const python = yield* ensureManagedPythonCommand()

          const cwd = path.isAbsolute(params.workdir ?? SessionCwd.get(ctx.sessionID))
            ? (params.workdir ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.workdir ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(cwd) : cwd
          const info = yield* fs.stat(normalized).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info || info.type !== "Directory") {
            throw new Error(`python workdir must be a directory: ${normalized}`)
          }

          yield* assertExternalDirectoryEffect(ctx, normalized, { kind: "directory" })
          const patchBypass = PatchRecovery.blockedShellWrite(ctx.sessionID, ctx.messageID, normalized, params.code)
          if (patchBypass) throw new Error(patchBypass)
          yield* ctx.ask({
            permission: "bash",
            patterns: [python.command],
            always: ["*"],
            metadata: {
              command: formatPythonCommand(python),
              workdir: normalized,
            },
          })

          const runtime = shellBackgroundRuntimeRef.current
          if (!runtime) throw new Error("Shell background runtime is not available in this process.")
          const job = yield* runtime.start({
            sessionID: ctx.sessionID,
            source: "python",
            title: params.description || path.basename(normalized),
            cwd: normalized,
            env: Object.fromEntries(
              Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
            shell: "",
            shellName: "argv",
            argv: [python.command, ...python.args, "{jobRoot}/script.py", ...(params.args ?? [])],
            files: [{ name: "script.py", content: params.code }],
            ...(params.timeout !== undefined ? { remindAfterMs: params.timeout } : {}),
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })

          return {
            title: params.description || path.basename(normalized),
            output: `Started tracked Python shell process.\n<job_id>${job.id}</job_id>\n<status>${job.status}</status>\nCompletion is reported automatically; use shell_process only when inspection is needed. Only shell_process.cancel after an explicit user request can terminate it.`,
            metadata: {
              python: formatPythonCommand(python),
              description: params.description,
              jobID: job.id,
              status: job.status,
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    }
  }),
)
