import path from "path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { AppFileSystem } from "@/filesystem"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { buildCppRunCommand, defaultCppOutputPath, resolveCppCommand } from "@/cpp/runtime"

const SourceExtension = new Set([".cpp", ".cc", ".cxx", ".c++"])

const PrepareTerminalRunOutput = z.object({
  command: z.string(),
  cwd: z.string(),
  sourcePath: z.string(),
  outputPath: z.string(),
  terminalTitle: z.string(),
})

export const CppRoutes = lazy(() =>
  new Hono().post(
    "/prepare-terminal-run",
    describeRoute({
      summary: "Prepare C++ terminal run",
      description: "Resolve compiler/runtime paths and return a PowerShell 7 command string that compiles and runs a single C++ file.",
      operationId: "cpp.prepareTerminalRun",
      responses: {
        200: {
          description: "Prepared terminal run payload",
          content: {
            "application/json": {
              schema: resolver(PrepareTerminalRunOutput),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        path: z.string(),
        args: z.array(z.string()).optional(),
      }),
    ),
    async (c) =>
      jsonRequest("CppRoutes.prepareTerminalRun", c, function* () {
        const fs = yield* AppFileSystem.Service
        const body = c.req.valid("json")
        const sourcePath = AppFileSystem.normalizePath(
          path.isAbsolute(body.path) ? body.path : path.join(Instance.directory, body.path),
        )
        if (!path.isAbsolute(body.path) && !Instance.containsPath(sourcePath, Instance.current)) {
          throw new Error("Access denied: path escapes project directory")
        }
        if (!(yield* fs.isFile(sourcePath))) {
          throw new Error(`C++ source file was not found: ${body.path}`)
        }
        if (!SourceExtension.has(path.extname(sourcePath).toLowerCase())) {
          throw new Error(`Unsupported C++ source extension: ${path.extname(sourcePath) || "<none>"}`)
        }
        const compiler = resolveCppCommand()
        if (!compiler) {
          throw new Error("No C++ compiler was found. Set LFCODE_CXX_PATH or install g++ / clang++.")
        }
        const outputPath = defaultCppOutputPath(Instance.directory, sourcePath)
        return {
          command: buildCppRunCommand({
            compiler,
            sourcePath,
            outputPath,
            args: body.args,
          }),
          cwd: Instance.directory,
          sourcePath,
          outputPath,
          terminalTitle: "C++ Run",
        }
      }),
  ),
)
