import path from "path"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@/filesystem"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"
import { inferReadKind, inspectArchiveFile, type ReadKind } from "./file-inspect"
import DESCRIPTION from "./archive_inspect.txt"

const MAX_ARCHIVE_INSPECT_BYTES = 20 * 1024 * 1024
const DEFAULT_LIMIT = 200

type ArchiveInspectMetadata = {
  kind?: ReadKind
  mode: "list" | "summary" | "extract-text"
  mime?: string
  fileSize: number
  entryCount?: number
  truncated: boolean
  totalLines?: number
  nextOffset?: number
}

const Parameters = z.object({
  filePath: z.string().describe("The archive or office-document path to inspect."),
  mode: z
    .enum(["list", "summary", "extract-text"])
    .optional()
    .describe("list shows entries, summary gives a concise overview, extract-text returns extracted document text when available."),
  offset: z.coerce.number().optional().describe("1-indexed starting line or entry number for paginated output."),
  limit: z.coerce.number().optional().describe(`Maximum number of entries or lines to return. Defaults to ${DEFAULT_LIMIT}.`),
})

export const ArchiveInspectTool = Tool.define(
  "archive_inspect",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const definition: Tool.DefWithoutID<typeof Parameters, ArchiveInspectMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const mode = params.mode ?? "summary"
          const offset = params.offset ?? 1
          const limit = params.limit ?? DEFAULT_LIMIT
          if (offset < 1) throw new Error("offset must be greater than or equal to 1")
          if (limit < 1) throw new Error("limit must be greater than or equal to 1")

          const search = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(SessionCwd.get(ctx.sessionID), params.filePath)
          const filepath = process.platform === "win32" ? AppFileSystem.normalizePath(search) : search

          const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, filepath, { kind: "file" })
          yield* ctx.ask({
            permission: "read",
            patterns: [filepath],
            always: ["*"],
            metadata: {
              mode,
            },
          })

          if (!stat || stat.type !== "File") throw new Error(`archive_inspect path must be a file: ${filepath}`)
          const fileSize = Number(stat.size)
          if (fileSize > MAX_ARCHIVE_INSPECT_BYTES) {
            return {
              title: path.basename(filepath),
              output: [
                `<path>${filepath}</path>`,
                "<type>archive</type>",
                `<size>${fileSize}</size>`,
                `File is too large to inspect inline (${Math.ceil(fileSize / 1024 / 1024)} MB).`,
              ].join("\n"),
              metadata: {
                mode,
                fileSize,
                truncated: false,
              },
            }
          }

          const mime = AppFileSystem.mimeType(filepath)
          const kind = inferReadKind(filepath, mime)
          if (kind !== "archive" && kind !== "document") {
            throw new Error(`archive_inspect only supports archive/document files, got ${kind}: ${filepath}`)
          }

          const bytes = yield* fs.readFile(filepath)
          const inspected = yield* Effect.tryPromise({
            try: () => inspectArchiveFile(filepath, bytes),
            catch: (error) =>
              new Error(`Failed to inspect archive contents: ${error instanceof Error ? error.message : String(error)}`),
          })
          const entryCount = inspected.entries.length

          if (mode === "extract-text") {
            if (!inspected.text) {
              return {
                title: path.basename(filepath),
                output: [
                  `<path>${filepath}</path>`,
                  `<type>${inspected.kind}</type>`,
                  `<mime>${mime}</mime>`,
                  `<entries>${entryCount}</entries>`,
                  "No extractable text available for this archive.",
                ].join("\n"),
                metadata: {
                  kind: inspected.kind,
                  mode,
                  mime,
                  fileSize,
                  entryCount,
                  truncated: false,
                },
              }
            }

            const text = paginate(inspected.text.length === 0 ? [] : inspected.text.split(/\r?\n/u), offset, limit)
            return {
              title: path.basename(filepath),
              output: [
                `<path>${filepath}</path>`,
                `<type>${inspected.kind}</type>`,
                `<mime>${mime}</mime>`,
                "<content>",
                text.items.map((line, index) => `${text.offset + index}: ${line}`).join("\n"),
                text.more
                  ? `\n(Showing lines ${text.offset}-${text.offset + text.items.length - 1} of ${text.count}. Use offset=${text.offset + text.items.length} to continue.)`
                  : `\n(End of extracted text - total ${text.count} lines)`,
                "</content>",
              ].join("\n"),
              metadata: {
                kind: inspected.kind,
                mode,
                mime,
                fileSize,
                entryCount,
                truncated: text.more,
                totalLines: text.count,
                nextOffset: text.more ? text.offset + text.items.length : undefined,
              },
            }
          }

          if (mode === "list") {
            const entries = paginate(inspected.entries, offset, limit)
            return {
              title: path.basename(filepath),
              output: [
                `<path>${filepath}</path>`,
                `<type>${inspected.kind}</type>`,
                `<mime>${mime}</mime>`,
                "<entries>",
                entries.items.join("\n"),
                entries.more
                  ? `\n(Showing ${entries.items.length} of ${entries.count} entries. Use offset=${entries.offset + entries.items.length} to continue.)`
                  : `\n(${entries.count} entries)`,
                "</entries>",
              ].join("\n"),
              metadata: {
                kind: inspected.kind,
                mode,
                mime,
                fileSize,
                entryCount,
                truncated: entries.more,
                nextOffset: entries.more ? entries.offset + entries.items.length : undefined,
              },
            }
          }

          const preview = inspected.entries.slice(0, Math.min(entryCount, 20))
          const textPreview = inspected.text
            ? inspected.text
                .split(/\r?\n/u)
                .filter(Boolean)
                .slice(0, 10)
            : []
          return {
            title: path.basename(filepath),
            output: [
              `<path>${filepath}</path>`,
              `<type>${inspected.kind}</type>`,
              `<mime>${mime}</mime>`,
              `<entries>${entryCount}</entries>`,
              ...(preview.length > 0 ? ["<entry-preview>", ...preview, "</entry-preview>"] : []),
              ...(textPreview.length > 0 ? ["<text-preview>", ...textPreview, "</text-preview>"] : []),
            ].join("\n"),
            metadata: {
              kind: inspected.kind,
              mode,
              mime,
              fileSize,
              entryCount,
              truncated: false,
            },
          }
        }).pipe(Effect.orDie),
    }
    return definition
  }),
)

function paginate(items: string[], offset: number, limit: number) {
  const start = Math.max(0, offset - 1)
  const slice = items.slice(start, start + limit)
  return {
    items: slice,
    count: items.length,
    more: start + slice.length < items.length,
    offset,
  }
}
