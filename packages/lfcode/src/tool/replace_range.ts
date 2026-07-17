import path from "path"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import * as Tool from "./tool"
import { ApplyPatchTool } from "./apply_patch"
import DESCRIPTION from "./replace_range.txt"
import { assertWriteAllowed } from "./external-directory"
import { buildRangePatchText } from "./range-patch"
import { SessionCwd } from "./session-cwd"
import * as PatchRecovery from "./patch-recovery"

const Parameters = z.object({
  filePath: z.string().describe("The absolute or relative path to the file to modify."),
  startLine: z.coerce.number().int().min(1).describe("The first line in the range (1-based)."),
  startChar: z.coerce.number().int().min(1).optional().describe("The first character in the range (1-based, inclusive). Defaults to 1."),
  endLine: z.coerce.number().int().min(1).describe("The last line touched by the range (1-based)."),
  endChar: z.coerce.number().int().min(1).optional().describe("The character just after the range (1-based, exclusive). Defaults to the end of endLine."),
  newText: z.string().describe("The replacement text for the selected range."),
  expected_version: z.string().regex(/^[a-f0-9]{64}$/i).optional().describe("Optional SHA-256 version returned by read. If it changed, re-read before editing."),
})

export const ReplaceRangeTool = Tool.define(
  "replace_range",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const patch = yield* ApplyPatchTool
    const applyPatch = yield* Tool.init(patch)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const search = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(SessionCwd.get(ctx.sessionID), params.filePath)
          const filePath = process.platform === "win32" ? AppFileSystem.normalizePath(search) : search
          yield* assertWriteAllowed(ctx, filePath)

          const stat = yield* fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!stat || stat.type !== "File") throw new Error(`replace_range path must be a file: ${filePath}`)

          const currentBytes = yield* fs.readFile(filePath)
          if (params.expected_version && params.expected_version !== PatchRecovery.contentVersion(currentBytes)) {
            return yield* Effect.fail(
              new Error(
                `[tool_error] ${JSON.stringify({
                  type: "tool_error",
                  tool: "replace_range",
                  category: "context",
                  field: "expected_version",
                  fields: ["expected_version"],
                  retryable: true,
                  recovery: "Read the target file again and retry with the new version.",
                  message: "The file changed after the previous read.",
                })}\nThe file changed after the previous read. Read it again before editing.`,
              ),
            )
          }
          const content = yield* fs.readFileString(filePath)
          const patchText = buildRangePatchText(filePath, content, params)
          return yield* applyPatch.execute({ patchText }, ctx)
        }).pipe(Effect.orDie),
    }
  }),
)
