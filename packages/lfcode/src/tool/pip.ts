import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./pip.txt"
import { AppFileSystem } from "@/filesystem"
import { ensureManagedPythonCommand } from "@/python/environment"
import { formatPythonCommand } from "@/python/runtime"
import { Process } from "@/util"
import { SessionCwd } from "./session-cwd"
import { startForegroundJob } from "@/background-job/foreground"

const DEFAULT_TIMEOUT = 2 * 60 * 1000

const Parameters = z.object({
  action: z
    .enum(["install", "uninstall", "upgrade", "list", "show", "freeze"])
    .describe("The pip action to perform."),
  packages: z
    .array(z.string())
    .optional()
    .describe("Package names for install, uninstall, upgrade, or show. Omit for list and freeze."),
  extraArgs: z.array(z.string()).optional().describe("Optional extra pip CLI arguments."),
  timeout: z.number().optional().describe("Optional timeout in milliseconds. Defaults to 120000."),
  workdir: z
    .string()
    .optional()
    .describe("Optional working directory. Defaults to the current session directory."),
  description: z.string().describe("Clear, concise description of what this pip command does in 5-10 words."),
})

function needsPackages(action: z.infer<typeof Parameters>["action"]) {
  return action === "install" || action === "uninstall" || action === "upgrade" || action === "show"
}

function buildPipArgs(params: z.infer<typeof Parameters>) {
  const extra = params.extraArgs ?? []
  const packages = params.packages ?? []
  if (params.action === "install") return ["-m", "pip", "install", ...extra, ...packages]
  if (params.action === "uninstall") return ["-m", "pip", "uninstall", "-y", ...extra, ...packages]
  if (params.action === "upgrade") return ["-m", "pip", "install", "--upgrade", ...extra, ...packages]
  if (params.action === "show") return ["-m", "pip", "show", ...extra, ...packages]
  if (params.action === "freeze") return ["-m", "pip", "freeze", ...extra]
  return ["-m", "pip", "list", ...extra]
}

function renderOutput(input: { stdout: string; stderr: string; exit: number; timeout: number; timedOut: boolean }) {
  const sections = [input.stdout, input.stderr].filter(Boolean)
  const output = sections.join(sections.length === 2 ? "\n\n" : "")
  if (!output && input.exit === 0) return "pip command completed with no output."
  if (!output && input.exit !== 0 && !input.timedOut) return `pip command failed with exit code ${input.exit} and no output.`
  if (!input.timedOut) return output
  const timeoutLine = `pip command timed out after ${input.timeout}ms.`
  return output ? `${output}\n\n${timeoutLine}` : timeoutLine
}

export const PipTool = Tool.define(
  "pip",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (needsPackages(params.action) && (!params.packages || params.packages.length === 0)) {
            throw new Error(`pip action '${params.action}' requires at least one package name.`)
          }

          const python = yield* ensureManagedPythonCommand()
          const cwd = path.isAbsolute(params.workdir ?? SessionCwd.get(ctx.sessionID))
            ? (params.workdir ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.workdir ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(cwd) : cwd
          const info = yield* fs.stat(normalized).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info || info.type !== "Directory") throw new Error(`pip workdir must be a directory: ${normalized}`)

          const args = buildPipArgs(params)
          yield* ctx.ask({
            permission: "bash",
            patterns: [python.command],
            always: ["*"],
            metadata: {
              command: `${formatPythonCommand(python)} ${args.join(" ")}`,
              workdir: normalized,
            },
          })

          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          const timeoutAbort = AbortSignal.timeout(timeout)
          const abort = AbortSignal.any([ctx.abort, timeoutAbort])
          const job = startForegroundJob({
            sessionID: ctx.sessionID,
            source: "pip",
            title: params.description || `pip ${params.action}`,
            cwd: normalized,
            payload: {
              command: [python.command, ...python.args, ...args],
              tool: "pip",
            },
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })
          const result = yield* Effect.promise(() =>
            Process.run([python.command, ...python.args, ...args], {
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
            ...(timedOut ? { error: `pip command timed out after ${timeout}ms.` } : {}),
          })

          return {
            title: params.description || `pip ${params.action}`,
            output: renderOutput({
              stdout,
              stderr,
              exit: result.code,
              timeout,
              timedOut,
            }),
            metadata: {
              action: params.action,
              exit: result.code,
              python: formatPythonCommand(python),
              timedOut,
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    }
  }),
)
