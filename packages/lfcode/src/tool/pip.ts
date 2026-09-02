import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./pip.txt"
import { AppFileSystem } from "@/filesystem"
import { ensureManagedPythonCommand } from "@/python/environment"
import { formatPythonCommand } from "@/python/runtime"
import { SessionCwd } from "./session-cwd"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"

const Parameters = z.object({
  action: z.enum(["install", "uninstall", "upgrade", "list", "show", "freeze"]).describe("The pip action to perform."),
  packages: z
    .array(z.string())
    .optional()
    .describe("Package names for install, uninstall, upgrade, or show. Omit for list and freeze."),
  extraArgs: z.array(z.string()).optional().describe("Optional extra pip CLI arguments."),
  timeout: z.number().optional().describe("Optional reminder threshold in milliseconds. It never terminates pip."),
  workdir: z.string().optional().describe("Optional working directory. Defaults to the current session directory."),
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
  if (!output && input.exit !== 0 && !input.timedOut)
    return `pip command failed with exit code ${input.exit} and no output.`
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
            permission: "shell",
            patterns: [python.command],
            always: ["*"],
            metadata: {
              command: `${formatPythonCommand(python)} ${args.join(" ")}`,
              workdir: normalized,
            },
          })

          const runtime = shellBackgroundRuntimeRef.current
          if (!runtime) throw new Error("Shell background runtime is not available in this process.")
          const job = yield* runtime.start({
            sessionID: ctx.sessionID,
            source: "pip",
            title: params.description || `pip ${params.action}`,
            cwd: normalized,
            env: Object.fromEntries(
              Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
            shell: "",
            shellName: "argv",
            argv: [python.command, ...python.args, ...args],
            ...(params.timeout !== undefined ? { remindAfterMs: params.timeout } : {}),
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })

          return {
            title: params.description || `pip ${params.action}`,
            output: `Started tracked pip shell process.\n<job_id>${job.id}</job_id>\n<status>${job.status}</status>\nCompletion is reported automatically; use shell_process only when inspection is needed. Only shell_process.cancel after an explicit user request can terminate it.`,
            metadata: {
              action: params.action,
              python: formatPythonCommand(python),
              jobID: job.id,
              status: job.status,
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    }
  }),
)
