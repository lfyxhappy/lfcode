import os from "os"
import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./python.txt"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"
import { Process } from "@/util"
import { Instance } from "../project/instance"
import { ensureManagedPythonCommand } from "@/python/environment"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"
import { formatPythonCommand } from "@/python/runtime"
import { startForegroundJob } from "@/background-job/foreground"

const DEFAULT_TIMEOUT = 2 * 60 * 1000
const MODULE_NOT_FOUND = /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i

const Parameters = z.object({
  code: z.string().describe("The Python code to execute."),
  args: z.array(z.string()).optional().describe("Optional CLI args exposed to the script as sys.argv[1:]."),
  timeout: z.number().optional().describe("Optional timeout in milliseconds. Defaults to 120000."),
  workdir: z
    .string()
    .optional()
    .describe("Optional working directory. Defaults to the current session directory."),
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
          yield* ctx.ask({
            permission: "bash",
            patterns: [python.command],
            always: ["*"],
            metadata: {
              command: formatPythonCommand(python),
              workdir: normalized,
            },
          })

          const dir = yield* fs.makeTempDirectoryScoped({
            directory: Global.Path.cache || os.tmpdir(),
            prefix: "python-tool-",
          })
          const script = path.join(dir, "script.py")
          yield* fs.writeFileString(script, params.code)

          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          const timeoutAbort = AbortSignal.timeout(timeout)
          const abort = AbortSignal.any([ctx.abort, timeoutAbort])
          const job = startForegroundJob({
            sessionID: ctx.sessionID,
            source: "python",
            title: params.description || path.relative(Instance.worktree, normalized) || "python",
            cwd: normalized,
            payload: {
              command: [python.command, ...python.args, script, ...(params.args ?? [])],
              tool: "python",
            },
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })
          const result = yield* Effect.promise(() =>
            Process.run([python.command, ...python.args, script, ...(params.args ?? [])], {
              cwd: normalized,
              abort,
              nothrow: true,
              onSpawn: (process) => job.attach(process.pid),
              onOutput: (entry) => job.append(entry.stream, entry.chunk.toString("utf8")),
            }),
          )

          const stdout = result.stdout.toString("utf8").trimEnd()
          const stderr = result.stderr.toString("utf8").trimEnd()
          const timedOut = timeoutAbort.aborted && !ctx.abort.aborted
          job.complete({
            status: ctx.abort.aborted ? "cancelled" : timedOut || result.code !== 0 ? "failed" : "completed",
            exitCode: result.code,
            ...(timedOut ? { error: `Python script timed out after ${timeout}ms.` } : {}),
          })
          const output = renderOutput({
            stdout,
            stderr,
            exit: result.code,
            timeout,
            timedOut,
          })
          const hint = renderDependencyHint(stderr)

          return {
            title: params.description || path.relative(Instance.worktree, normalized) || "python",
            output: hint ? `${output}\n\n${hint}` : output,
            metadata: {
              exit: result.code,
              python: formatPythonCommand(python),
              description: params.description,
              timedOut,
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    }
  }),
)
