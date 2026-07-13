import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import { AppFileSystem } from "@/filesystem"

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2_000

const parameters = z
  .object({
    reference: z.string().describe("Opaque output reference returned by a truncated tool result, for example tool-output:tool_xxx"),
    operation: z.enum(["read", "search"]).default("read").describe("Read a bounded line range or search matching lines"),
    offset: z.coerce.number().int().min(1).optional().describe("1-indexed line offset for read"),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().describe("Maximum returned lines, capped at 2000"),
    query: z.string().min(1).optional().describe("Case-insensitive text to search for; required for search"),
  })
  .superRefine((value, ctx) => {
    if (value.operation !== "search" || value.query) return
    ctx.addIssue({ code: "custom", path: ["query"], message: "query is required when operation is search" })
  })

export const ToolOutputTool = Tool.define(
  "tool_output",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const run = Effect.fn("ToolOutputTool.execute")(function* (params: z.infer<typeof parameters>) {
      const filepath = Truncate.resolveOutputReference(params.reference)
      if (!filepath) return yield* Effect.fail(new Error("Invalid tool output reference."))

      const content = yield* fs
        .readFileString(filepath)
        .pipe(Effect.mapError(() => new Error("The referenced tool output is no longer available.")))
      const limit = params.limit ?? DEFAULT_LIMIT
      const lines = Truncate.redact(content).split("\n")
      const selected =
        params.operation === "search"
          ? lines
              .map((line, index) => ({ line, number: index + 1 }))
              .filter((item) => item.line.toLowerCase().includes(params.query!.toLowerCase()))
          : lines.slice((params.offset ?? 1) - 1, (params.offset ?? 1) - 1 + limit).map((line, index) => ({
              line,
              number: (params.offset ?? 1) + index,
            }))
      const sliced = selected.slice(0, limit)
      const more = selected.length > sliced.length
      const nextOffset =
        params.operation === "read" && more ? (params.offset ?? 1) + sliced.length : undefined

      return {
        title: params.reference,
        output: [
          `<tool_output reference="${params.reference}" operation="${params.operation}">`,
          ...sliced.map((item) => `${item.number}: ${item.line}`),
          more
            ? params.operation === "search"
              ? `(Showing ${sliced.length} matching lines. Narrow query or use a more specific search.)`
              : `(Showing lines ${params.offset ?? 1}-${(params.offset ?? 1) + sliced.length - 1}. Use offset=${nextOffset} to continue.)`
            : `(End of captured output. ${params.operation === "search" ? `${selected.length} matches` : `${lines.length} lines`})`,
          "</tool_output>",
        ].join("\n"),
        metadata: {
          reference: params.reference,
          operation: params.operation,
          totalLines: lines.length,
          matchedLines: params.operation === "search" ? selected.length : undefined,
          nextOffset,
          truncated: more,
        },
      }
    })

    return {
      description:
        "Read or search a bounded portion of a previously truncated tool output. Only accepts an opaque tool-output reference; it cannot access arbitrary filesystem paths.",
      parameters,
      execute: (params: z.infer<typeof parameters>) => run(params).pipe(Effect.orDie),
    }
  }),
)
