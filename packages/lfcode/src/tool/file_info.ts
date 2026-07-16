import path from "path"
import z from "zod"
import { Effect, Option } from "effect"
import { AppFileSystem } from "@/filesystem"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import { assertExternalDirectoryEffect } from "./external-directory"
import { inferReadKind, isBinaryFile } from "./file-inspect"

const SAMPLE_BYTES = 4096

const Parameters = z.object({
  path: z.string().describe("The absolute or relative path to inspect"),
})

type FileInfoMetadata = {
  exists: boolean
  type?: "file" | "directory"
  kind?: ReturnType<typeof inferReadKind>
  size?: number
  mime?: string
  mtime?: string
  isBinary?: boolean
  isDirectory?: boolean
  truncated: boolean
}

export const FileInfoTool = Tool.define(
  "file_info",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const definition: Tool.DefWithoutID<typeof Parameters, FileInfoMetadata> = {
      description:
        "Get lightweight metadata for a file or directory without reading the full contents. Use this before read when you only need existence, size, type, mime, or modification time.",
      parameters: Parameters,
      execute: (params: { path: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          let filepath = params.path
          if (!path.isAbsolute(filepath)) filepath = path.resolve(SessionCwd.get(ctx.sessionID), filepath)
          if (process.platform === "win32") filepath = AppFileSystem.normalizePath(filepath)

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

          if (!stat) {
            return {
              title: path.basename(filepath),
              output: [
                `<path>${filepath}</path>`,
                "<exists>false</exists>",
              ].join("\n"),
              metadata: {
                exists: false,
                truncated: false,
              },
            }
          }

          if (stat.type === "Directory") {
            const entries = yield* fs.readDirectoryEntries(filepath).pipe(Effect.catch(() => Effect.succeed([])))
            return {
              title: path.basename(filepath),
              output: [
                `<path>${filepath}</path>`,
                "<exists>true</exists>",
                "<type>directory</type>",
                `<size>${entries.length}</size>`,
              ].join("\n"),
              metadata: {
                exists: true,
                type: "directory" as const,
                size: entries.length,
                mime: "application/x-directory",
                isBinary: false,
                isDirectory: true,
                truncated: false,
              },
            }
          }

          const file =
            Number(stat.size) === 0
              ? new Uint8Array()
              : (yield* fs.readFile(filepath)).slice(0, Math.min(SAMPLE_BYTES, Number(stat.size)))
          const mime = AppFileSystem.mimeType(filepath)
          const kind = inferReadKind(filepath, mime)
          const binary = kind === "archive" || kind === "document" || isBinaryFile(filepath, file)
          const mtime = stat.mtime.pipe(
            Option.map((value) => value.toISOString()),
            Option.getOrElse(() => undefined),
          )

          return {
            title: path.basename(filepath),
            output: [
              `<path>${filepath}</path>`,
              "<exists>true</exists>",
              "<type>file</type>",
              `<kind>${kind}</kind>`,
              `<mime>${mime}</mime>`,
              `<size>${Number(stat.size)}</size>`,
              ...(mtime ? [`<mtime>${mtime}</mtime>`] : []),
              `<binary>${binary}</binary>`,
            ].join("\n"),
            metadata: {
              exists: true,
              type: "file" as const,
              kind,
              size: Number(stat.size),
              mime,
              mtime,
              isBinary: binary,
              isDirectory: false,
              truncated: false,
            },
          }
        }).pipe(Effect.orDie),
    }
    return definition
  }),
)
