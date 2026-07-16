import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./cpp.txt"
import { AppFileSystem } from "@/filesystem"
import { Process } from "@/util"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import {
  buildCppCompileCommand,
  cppProcessEnv,
  buildCppRunCommand,
  defaultCppOutputPath,
  formatCppCommand,
  resolveCppCommand,
} from "@/cpp/runtime"
import { installManagedCppCompiler } from "@/runtime-registry/cpp"
import { startForegroundJob } from "@/background-job/foreground"

const DEFAULT_TIMEOUT = 2 * 60 * 1000
const SOURCE_EXTENSIONS = new Set([".cpp", ".cc", ".cxx", ".c++"])

const Parameters = z.object({
  entry: z.string().describe("Path to the C++ source file to compile. Relative paths resolve from the working directory."),
  mode: z.enum(["build", "run"]).describe("Whether to only compile or to compile and then run the binary."),
  args: z.array(z.string()).optional().describe("Optional runtime arguments when mode is run."),
  compilerArgs: z.array(z.string()).optional().describe("Optional extra compiler flags."),
  workdir: z.string().optional().describe("Optional working directory. Defaults to the current session directory."),
  timeout: z.number().optional().describe("Optional timeout in milliseconds for each compile or run phase. Defaults to 120000."),
  description: z.string().describe("Clear, concise description of what this C++ run does in 5-10 words."),
})

type CppMetadata = {
  mode: "build" | "run"
  compileExit: number
  runExit?: number
  compiler: string
  outputPath: string
  timedOut: boolean
}

function compileArgs(input: {
  compilerArgs?: string[]
  sourcePath: string
  outputPath: string
}) {
  return [input.sourcePath, "-std=c++20", ...(input.compilerArgs ?? []), "-o", input.outputPath]
}

function renderPhase(label: string, payload: { stdout: string; stderr: string; exit: number; timedOut: boolean; timeout: number }) {
  const body = [payload.stdout, payload.stderr].filter(Boolean).join(payload.stdout && payload.stderr ? "\n\n" : "")
  if (payload.timedOut) {
    const suffix = `Timed out after ${payload.timeout}ms.`
    return `## ${label}\n${body ? `${body}\n\n${suffix}` : suffix}`
  }
  if (!body && payload.exit === 0) return `## ${label}\nCompleted with no output.`
  if (!body) return `## ${label}\nFailed with exit code ${payload.exit} and no output.`
  return `## ${label}\n${body}`
}

export const CppTool = Tool.define(
  "cpp",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const definition: Tool.DefWithoutID<typeof Parameters, CppMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const compiler = yield* ensureCppCompiler(ctx)

          const cwd = path.isAbsolute(params.workdir ?? SessionCwd.get(ctx.sessionID))
            ? (params.workdir ?? SessionCwd.get(ctx.sessionID))
            : path.resolve(SessionCwd.get(ctx.sessionID), params.workdir ?? ".")
          const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(cwd) : cwd
          if (!(yield* fs.isDir(normalized))) {
            throw new Error(`cpp workdir must be a directory: ${normalized}`)
          }
          yield* assertExternalDirectoryEffect(ctx, normalized, { kind: "directory" })

          const sourcePath = path.isAbsolute(params.entry) ? params.entry : path.resolve(normalized, params.entry)
          const normalizedSource = process.platform === "win32" ? AppFileSystem.normalizePath(sourcePath) : sourcePath
          if (!(yield* fs.isFile(normalizedSource))) {
            throw new Error(`C++ source file was not found: ${normalizedSource}`)
          }
          if (!SOURCE_EXTENSIONS.has(path.extname(normalizedSource).toLowerCase())) {
            throw new Error(`Unsupported C++ source extension: ${path.extname(normalizedSource) || "<none>"}`)
          }
          yield* assertExternalDirectoryEffect(ctx, normalizedSource, { kind: "file" })

          const outputPath = defaultCppOutputPath(normalized, normalizedSource)
          yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true })
          const compileCommand = buildCppCompileCommand({
            compiler,
            sourcePath: normalizedSource,
            outputPath,
            compilerArgs: params.compilerArgs,
          })
          const runCommand = buildCppRunCommand({
            compiler,
            sourcePath: normalizedSource,
            outputPath,
            compilerArgs: params.compilerArgs,
            args: params.args,
          })
          yield* ctx.ask({
            permission: "bash",
            patterns: [compiler.command],
            always: ["*"],
            metadata: {
              command: params.mode === "run" ? runCommand : compileCommand,
              workdir: normalized,
            },
          })

          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          const compileTimeout = AbortSignal.timeout(timeout)
          const compileAbort = AbortSignal.any([ctx.abort, compileTimeout])
          const job = startForegroundJob({
            sessionID: ctx.sessionID,
            source: "cpp",
            title: params.description || path.basename(normalizedSource),
            cwd: normalized,
            payload: {
              command: params.mode === "run" ? runCommand : compileCommand,
              tool: "cpp",
              mode: params.mode,
            },
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })
          const compileResult = yield* Effect.promise(() =>
            Process.run([compiler.command, ...compiler.args, ...compileArgs({
              sourcePath: normalizedSource,
              outputPath,
              compilerArgs: params.compilerArgs,
            })], {
              cwd: normalized,
              env: cppProcessEnv(compiler),
              abort: compileAbort,
              nothrow: true,
              onSpawn: (process) => job.attach(process.pid),
              onOutput: (entry) => job.append(entry.stream, entry.chunk.toString("utf8")),
            }),
          )
          const compileStdout = compileResult.stdout.toString("utf8").trimEnd()
          const compileStderr = compileResult.stderr.toString("utf8").trimEnd()
          const compileTimedOut = compileTimeout.aborted && !ctx.abort.aborted

          if (params.mode === "build" || compileResult.code !== 0 || compileTimedOut) {
            job.complete({
              status: ctx.abort.aborted ? "cancelled" : compileTimedOut || compileResult.code !== 0 ? "failed" : "completed",
              exitCode: compileResult.code,
              ...(compileTimedOut ? { error: `C++ compilation timed out after ${timeout}ms.` } : {}),
            })
            return {
              title: params.description || path.basename(normalizedSource),
              output: [
                renderPhase("Compile", {
                  stdout: compileStdout,
                  stderr: compileStderr,
                  exit: compileResult.code,
                  timedOut: compileTimedOut,
                  timeout,
                }),
                compileResult.code === 0 && !compileTimedOut ? `\nOutput: ${outputPath}` : "",
              ].join("\n"),
              metadata: {
                mode: params.mode,
                compileExit: compileResult.code,
                runExit: undefined,
                compiler: formatCppCommand(compiler),
                outputPath,
                timedOut: compileTimedOut,
              },
            }
          }

          const runTimeout = AbortSignal.timeout(timeout)
          const runAbort = AbortSignal.any([ctx.abort, runTimeout])
          const runResult = yield* Effect.promise(() =>
            Process.run([outputPath, ...(params.args ?? [])], {
              cwd: normalized,
              env: cppProcessEnv(compiler),
              abort: runAbort,
              nothrow: true,
              onSpawn: (process) => job.attach(process.pid),
              onOutput: (entry) => job.append(entry.stream, entry.chunk.toString("utf8")),
            }),
          )
          const runStdout = runResult.stdout.toString("utf8").trimEnd()
          const runStderr = runResult.stderr.toString("utf8").trimEnd()
          const runTimedOut = runTimeout.aborted && !ctx.abort.aborted
          job.complete({
            status: ctx.abort.aborted ? "cancelled" : runTimedOut || runResult.code !== 0 ? "failed" : "completed",
            exitCode: runResult.code,
            ...(runTimedOut ? { error: `C++ program timed out after ${timeout}ms.` } : {}),
          })

          return {
            title: params.description || path.basename(normalizedSource),
            output: [
              renderPhase("Compile", {
                stdout: compileStdout,
                stderr: compileStderr,
                exit: compileResult.code,
                timedOut: false,
                timeout,
              }),
              "",
              renderPhase("Run", {
                stdout: runStdout,
                stderr: runStderr,
                exit: runResult.code,
                timedOut: runTimedOut,
                timeout,
              }),
              "",
              `Output: ${outputPath}`,
            ].join("\n"),
            metadata: {
              mode: params.mode,
              compileExit: compileResult.code,
              runExit: runResult.code,
              compiler: formatCppCommand(compiler),
              outputPath,
              timedOut: runTimedOut,
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    }
    return definition
  }),
)

const ensureCppCompiler = Effect.fn("CppTool.ensureCppCompiler")(function* (ctx: Tool.Context) {
  const existing = resolveCppCommand()
  if (existing) return existing
  if (process.platform !== "win32") {
    throw new Error(
      "No C++ compiler was found. Open Settings -> Runtimes to install the managed MinGW toolchain, or set LFCODE_CXX_PATH / install g++ / clang++ manually.",
    )
  }
  yield* ctx.ask({
    permission: "bash",
    patterns: ["runtime:install:cpp-compiler"],
    always: ["*"],
    metadata: {
      command: "runtime install cpp-compiler",
      runtime_action: "install",
      runtime_id: "cpp-compiler",
    },
  })
  yield* Effect.promise(() => installManagedCppCompiler())
  const installed = resolveCppCommand()
  if (installed) return installed
  throw new Error(
    "No C++ compiler was found. Open Settings -> Runtimes to install the managed MinGW toolchain, or set LFCODE_CXX_PATH / install g++ / clang++ manually.",
  )
})
