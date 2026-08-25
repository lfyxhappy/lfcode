import z from "zod"
import { Effect, Scope } from "effect"
import { createReadStream } from "fs"
import * as path from "path"
import { createInterface } from "readline"
import * as Tool from "./tool"
import { AppFileSystem } from "@/filesystem"
import { LSP } from "../lsp"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import { Instruction } from "../session/instruction"
import { isImageAttachment, isPdfAttachment, sniffAttachmentMime } from "@/util/media"
import { inferReadKind, inspectArchiveFile, isBinaryFile, type ReadKind } from "./file-inspect"
import * as PatchRecovery from "./patch-recovery"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const MAX_ARCHIVE_INSPECT_BYTES = 20 * 1024 * 1024

function versionAnchor(version: string) {
  return `<version>${version}</version>\nUse the returned current text as the source context for edit.`
}

const parameters = z.object({
  filePath: z.string().describe("The absolute or relative path to the file or directory to read."),
  offset: z.coerce.number().describe("The line number to start reading from (1-indexed)").optional(),
  limit: z.coerce.number().describe("The maximum number of lines to read (defaults to 2000)").optional(),
  startChar: z.coerce
    .number()
    .int()
    .min(1)
    .describe("For a single requested line, the first character to return (1-indexed, inclusive).")
    .optional(),
  endChar: z.coerce
    .number()
    .int()
    .min(1)
    .describe("For a single requested line, the character just after the returned range (1-indexed, exclusive).")
    .optional(),
})

type ReadMetadata = {
  kind: ReadKind
  mime: string
  fileSize: number
  preview?: string
  truncated: boolean
  totalLines?: number
  nextOffset?: number
  version?: string
  resolvedSelection?: {
    startLine: number
    endLine: number
  }
  loaded: string[]
}

export const ReadTool = Tool.define(
  "read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* fs.readDirectory(dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      yield* lsp.touchFile(filepath, false).pipe(Effect.ignore, Effect.forkIn(scope))
    })

    const readSample = Effect.fn("ReadTool.readSample")(function* (
      filepath: string,
      fileSize: number,
      sampleSize: number,
    ) {
      if (fileSize === 0) {
        const bytes = new Uint8Array()
        return { sample: bytes, version: PatchRecovery.contentVersion(bytes) }
      }
      const bytes = yield* fs.readFile(filepath)
      return {
        sample: bytes.slice(0, Math.min(sampleSize, fileSize)),
        version: PatchRecovery.contentVersion(bytes),
      }
    })

    const run = Effect.fn("ReadTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      if (params.offset !== undefined && params.offset < 1) {
        return yield* Effect.fail(new Error("offset must be greater than or equal to 1"))
      }
      if (
        (params.startChar !== undefined || params.endChar !== undefined) &&
        (params.offset === undefined || params.limit !== 1)
      ) {
        return yield* Effect.fail(
          new Error("startChar and endChar require offset and limit=1 so the requested line is unambiguous"),
        )
      }

      let filepath = params.filePath
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(SessionCwd.get(ctx.sessionID), filepath)
      }
      if (process.platform === "win32") {
        filepath = AppFileSystem.normalizePath(filepath)
      }
      const title = path.relative(Instance.worktree, filepath)

      const stat = yield* fs.stat(filepath).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )

      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [filepath],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath)

      if (stat.type !== "Directory" && PatchRecovery.needsRead(ctx.sessionID, ctx.messageID, filepath)) {
        const recoveryContent = yield* fs.readFile(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (recoveryContent) PatchRecovery.recordRead(ctx.sessionID, ctx.messageID, filepath, recoveryContent)
      }

      if (stat.type === "Directory") {
        const items = yield* list(filepath)
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset ?? 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length
        const nextOffset = truncated ? offset + sliced.length : undefined

        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            kind: "directory" as const,
            mime: "application/x-directory",
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            fileSize: items.length,
            nextOffset,
            resolvedSelection: sliced.length
              ? {
                  startLine: offset,
                  endLine: offset + sliced.length - 1,
                }
              : undefined,
            loaded: [] as string[],
          },
        }
      }

      const loaded = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const sampled = yield* readSample(filepath, Number(stat.size), SAMPLE_BYTES)
      const sample = sampled.sample
      const version = sampled.version
      const fileSize = Number(stat.size)

      const mime = sniffAttachmentMime(sample, AppFileSystem.mimeType(filepath))
      if (isImageAttachment(mime) || isPdfAttachment(mime)) {
        const bytes = yield* fs.readFile(filepath)
        const msg = isPdfAttachment(mime) ? "PDF read successfully" : "Image read successfully"
        const kind: ReadKind = isPdfAttachment(mime) ? "pdf" : "image"
        return {
          title,
          output: [msg, versionAnchor(version)].join("\n"),
          metadata: {
            kind,
            mime,
            fileSize,
            version,
            preview: msg,
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      const inferredKind = inferReadKind(filepath, mime)
      if (inferredKind === "archive" || inferredKind === "document") {
        if (fileSize > MAX_ARCHIVE_INSPECT_BYTES) {
          return {
            title,
            output: [
              `<path>${filepath}</path>`,
              `<type>${inferredKind}</type>`,
              versionAnchor(version),
              `<mime>${mime}</mime>`,
              `<size>${fileSize}</size>`,
              `File is too large to inspect inline (${Math.ceil(fileSize / 1024 / 1024)} MB).`,
            ].join("\n"),
            metadata: {
              kind: inferredKind,
              mime,
              fileSize,
              version,
              truncated: false,
              loaded: loaded.map((item) => item.filepath),
            },
          }
        }

        const bytes = yield* fs.readFile(filepath)
        const inspected = yield* Effect.promise(() => inspectArchiveFile(filepath, bytes)).pipe(
          Effect.catch(() =>
            Effect.succeed({
              kind: inferredKind,
              entries: [] as string[],
            }),
          ),
        )

        if ("text" in inspected && inspected.text) {
          const document = paginateText(inspected.text, params.offset ?? 1, params.limit ?? DEFAULT_READ_LIMIT)
          let output = [
            `<path>${filepath}</path>`,
            `<type>${inspected.kind}</type>`,
            versionAnchor(version),
            `<mime>${mime}</mime>`,
            "<content>\n",
          ].join("\n")
          output += document.raw.map((line, i) => `${i + document.offset}: ${line}`).join("\n")
          const last = document.offset + document.raw.length - 1
          const next = last + 1
          if (document.more) {
            output += `\n\n(Showing lines ${document.offset}-${last} of ${document.count}. Use offset=${next} to continue.)`
          } else {
            output += `\n\n(End of file - total ${document.count} lines)`
          }
          output += "\n</content>"
          return {
            title,
            output,
            metadata: {
              kind: inspected.kind,
              mime,
              fileSize,
              version,
              truncated: document.more,
              totalLines: document.count,
              nextOffset: document.more ? next : undefined,
              resolvedSelection: document.raw.length ? { startLine: document.offset, endLine: last } : undefined,
              preview: document.raw.slice(0, 20).join("\n"),
              loaded: loaded.map((item) => item.filepath),
            },
          }
        }

        const archive = paginateEntries(inspected.entries, params.offset ?? 1, params.limit ?? DEFAULT_READ_LIMIT)
        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>${inspected.kind}</type>`,
            versionAnchor(version),
            `<mime>${mime}</mime>`,
            `<entries>`,
            archive.raw.join("\n"),
            archive.more
              ? `\n(Showing ${archive.raw.length} of ${archive.count} entries. Use offset=${archive.offset + archive.raw.length} to continue.)`
              : `\n(${archive.count} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            kind: inspected.kind,
            mime,
            fileSize,
            version,
            truncated: archive.more,
            nextOffset: archive.more ? archive.offset + archive.raw.length : undefined,
            resolvedSelection: archive.raw.length
              ? { startLine: archive.offset, endLine: archive.offset + archive.raw.length - 1 }
              : undefined,
            preview: archive.raw.slice(0, 20).join("\n"),
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      if (isBinaryFile(filepath, sample)) {
        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>binary</type>`,
            versionAnchor(version),
            `<mime>${mime}</mime>`,
            `<size>${fileSize}</size>`,
            "Binary file cannot be rendered as text by read().",
          ].join("\n"),
          metadata: {
            kind: "binary" as const,
            mime,
            fileSize,
            version,
            preview: "",
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      const file = yield* Effect.promise(() =>
        lines(filepath, {
          limit: params.limit ?? DEFAULT_READ_LIMIT,
          offset: params.offset ?? 1,
          startChar: params.startChar,
          endChar: params.endChar,
        }),
      )
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, versionAnchor(version), "<content>\n"].join("\n")
      output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
      } else if (file.more) {
        output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)`
      }
      output += "\n</content>"

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      }

      return {
        title,
        output,
        metadata: {
          kind: "file" as const,
          mime,
          fileSize,
          version,
          preview: file.raw.slice(0, 20).join("\n"),
          truncated,
          totalLines: file.count,
          nextOffset: truncated ? next : undefined,
          resolvedSelection: file.raw.length ? { startLine: file.offset, endLine: last } : undefined,
          loaded: loaded.map((item) => item.filepath),
        },
      }
    })

    const definition: Tool.DefWithoutID<typeof parameters, ReadMetadata> = {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
    return definition
  }),
)

async function lines(filepath: string, opts: { limit: number; offset: number; startChar?: number; endChar?: number }) {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({
    input: stream,
    // Note: we use the crlfDelay option to recognize all instances of CR LF
    // ('\r\n') in file as a single line break.
    crlfDelay: Infinity,
  })

  const start = opts.offset - 1
  const raw: string[] = []
  let bytes = 0
  let count = 0
  let cut = false
  let more = false
  try {
    for await (const text of rl) {
      count += 1
      if (count <= start) continue

      if (raw.length >= opts.limit) {
        more = true
        continue
      }

      const line = sliceLine(text, opts)
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        cut = true
        more = true
        break
      }

      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return { raw, count, cut, more, offset: opts.offset }
}

function sliceLine(text: string, opts: { startChar?: number; endChar?: number }) {
  if (opts.startChar === undefined && opts.endChar === undefined) {
    return text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
  }
  const start = (opts.startChar ?? 1) - 1
  const end = opts.endChar === undefined ? text.length : opts.endChar - 1
  if (start > text.length || end > text.length || end < start) {
    throw new Error(
      `Character range ${opts.startChar ?? 1}-${opts.endChar ?? text.length + 1} is invalid for line length ${text.length}. Use 1 through ${text.length + 1}, with endChar exclusive.`,
    )
  }
  return text.slice(start, end)
}

function paginateText(input: string, offset: number, limit: number) {
  const all = input.length === 0 ? [] : input.split(/\r?\n/u)
  return paginateEntries(all, offset, limit)
}

function paginateEntries(all: string[], offset: number, limit: number) {
  const start = Math.max(0, offset - 1)
  const raw = all.slice(start, start + limit)
  return {
    raw,
    count: all.length,
    more: start + raw.length < all.length,
    offset,
  }
}
