import path from "path"
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./cpp.txt"
import { AppFileSystem } from "@/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { Shell } from "@/shell/shell"
import {
  buildCppCompileCommand,
  cppProcessEnv,
  buildCppRunCommand,
  defaultCppOutputPath,
  formatCppCommand,
  resolveCppCommand,
} from "@/cpp/runtime"
import { installManagedCppCompiler } from "@/runtime-registry/cpp"
const SOURCE_EXTENSIONS = new Set([".cpp", ".cc", ".cxx", ".c++"])

const Parameters = z.object({
  entry: z
    .string()
    .describe("Path to the C++ source file to compile. Relative paths resolve from the working directory."),
  mode: z.enum(["build", "run"]).describe("Whether to only compile or to compile and then run the binary."),
  args: z.array(z.string()).optional().describe("Optional runtime arguments when mode is run."),
  compilerArgs: z.array(z.string()).optional().describe("Optional extra compiler flags."),
  workdir: z.string().optional().describe("Optional working directory. Defaults to the current session directory."),
  timeout: z
    .number()
    .optional()
    .describe("Optional timeout in milliseconds for each compile or run phase. Defaults to 120000."),
  description: z.string().describe("Clear, concise description of what this C++ run does in 5-10 words."),
})

type CppMetadata = {
  mode: "build" | "run"
  compiler: string
  outputPath: string
  jobID: string
  status: string
}

function compileArgs(input: { compilerArgs?: string[]; sourcePath: string; outputPath: string }) {
  return [input.sourcePath, "-std=c++20", ...(input.compilerArgs ?? []), "-o", input.outputPath]
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
            permission: "shell",
            patterns: [compiler.command],
            always: ["*"],
            metadata: {
              command: params.mode === "run" ? runCommand : compileCommand,
              workdir: normalized,
            },
          })

          const runtime = shellBackgroundRuntimeRef.current
          if (!runtime) throw new Error("Shell background runtime is not available in this process.")
          const command =
            process.platform === "win32"
              ? params.mode === "run"
                ? runCommand
                : compileCommand
              : buildPosixCppCommand({
                  compiler,
                  sourcePath: normalizedSource,
                  outputPath,
                  compilerArgs: params.compilerArgs,
                  args: params.args,
                  mode: params.mode,
                })
          const env = Object.fromEntries(
            Object.entries(cppProcessEnv(compiler)).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
          const job = yield* runtime.start({
            sessionID: ctx.sessionID,
            source: "cpp",
            title: params.description || path.basename(normalizedSource),
            cwd: normalized,
            env,
            shell: process.platform === "win32" ? Shell.resolvePowerShell() : Shell.acceptable(),
            shellName: process.platform === "win32" ? "pwsh" : Shell.name(Shell.acceptable()),
            command,
            ...(params.timeout !== undefined ? { remindAfterMs: params.timeout } : {}),
            ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
            ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
          })

          return {
            title: params.description || path.basename(normalizedSource),
            output: `Started tracked C++ shell process.\n<job_id>${job.id}</job_id>\n<status>${job.status}</status>\n<output>${outputPath}</output>\nCompletion is reported automatically; use shell_process only when inspection is needed. Only shell_process.cancel after an explicit user request can terminate it.`,
            metadata: {
              mode: params.mode,
              compiler: formatCppCommand(compiler),
              outputPath,
              jobID: job.id,
              status: job.status,
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
    permission: "shell",
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

function buildPosixCppCommand(input: {
  compiler: { command: string; args: string[] }
  sourcePath: string
  outputPath: string
  compilerArgs?: string[]
  args?: string[]
  mode: "build" | "run"
}) {
  const compile = [input.compiler.command, ...input.compiler.args, ...compileArgs(input)].map(quotePosix).join(" ")
  if (input.mode === "build") return compile
  const run = [input.outputPath, ...(input.args ?? [])].map(quotePosix).join(" ")
  return `${compile} && ${run}`
}

function quotePosix(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
