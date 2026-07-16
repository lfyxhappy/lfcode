import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"

import { AppFileSystem } from "@/filesystem"
import { Git } from "@/git"
import { Effect, Layer, Context, Scope } from "effect"
import * as Stream from "effect/Stream"
import { formatPatch, structuredPatch } from "diff"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import path from "path"
import z from "zod"
import { sampledChecksum } from "@lfcode-ai/shared/util/encode"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Log } from "../util"
import { Protected } from "./protected"
import { Ripgrep } from "./ripgrep"

export const Info = z
  .object({
    path: z.string(),
    added: z.number().int(),
    removed: z.number().int(),
    status: z.enum(["added", "deleted", "modified"]),
  })
  .meta({
    ref: "File",
  })

export type Info = z.infer<typeof Info>

export const Node = z
  .object({
    name: z.string(),
    path: z.string(),
    absolute: z.string(),
    type: z.enum(["file", "directory"]),
    ignored: z.boolean(),
  })
  .meta({
    ref: "FileNode",
  })
export type Node = z.infer<typeof Node>

export const Content = z
  .object({
    exists: z.boolean(),
    type: z.enum(["text", "binary"]),
    content: z.string(),
    checksum: z.string(),
    diff: z.string().optional(),
    patch: z
      .object({
        oldFileName: z.string(),
        newFileName: z.string(),
        oldHeader: z.string().optional(),
        newHeader: z.string().optional(),
        hunks: z.array(
          z.object({
            oldStart: z.number(),
            oldLines: z.number(),
            newStart: z.number(),
            newLines: z.number(),
            lines: z.array(z.string()),
          }),
        ),
        index: z.string().optional(),
      })
      .optional(),
    encoding: z.literal("base64").optional(),
    mimeType: z.string().optional(),
  })
  .meta({
    ref: "FileContent",
  })
export type Content = z.infer<typeof Content>

export const Event = {
  Edited: BusEvent.define(
    "file.edited",
    z.object({
      file: z.string(),
    }),
  ),
}

const log = Log.create({ service: "file" })

function contentChecksum(content: string) {
  return sampledChecksum(content) ?? "0"
}

function decodeTextBytes(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return {
      content: "",
      encoding: "utf-8",
    } as const
  }

  const utf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (utf8Bom) {
    return {
      content: new TextDecoder("utf-8").decode(bytes.subarray(3)),
      encoding: "utf-8",
    } as const
  }

  const utf16LeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  if (utf16LeBom) {
    return {
      content: new TextDecoder("utf-16le").decode(bytes.subarray(2)),
      encoding: "utf-16le",
    } as const
  }

  const utf16BeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  if (utf16BeBom) {
    return {
      content: new TextDecoder("utf-16be").decode(bytes.subarray(2)),
      encoding: "utf-16be",
    } as const
  }

  const tryDecode = (encoding: string, fatal = true) => {
    try {
      return new TextDecoder(encoding, { fatal }).decode(bytes)
    } catch {
      return
    }
  }

  const utf8 = tryDecode("utf-8")
  if (utf8 !== undefined) {
    return {
      content: utf8,
      encoding: "utf-8",
    } as const
  }

  const zeroRatio = (parity: 0 | 1) => {
    let total = 0
    let zero = 0
    for (let index = parity; index < bytes.length; index += 2) {
      total += 1
      if (bytes[index] === 0) zero += 1
    }
    return total === 0 ? 0 : zero / total
  }

  const evenZeros = zeroRatio(0)
  const oddZeros = zeroRatio(1)
  if (oddZeros >= 0.35) {
    const utf16le = tryDecode("utf-16le", false)
    if (utf16le !== undefined) {
      return {
        content: utf16le,
        encoding: "utf-16le",
      } as const
    }
  }
  if (evenZeros >= 0.35) {
    const utf16be = tryDecode("utf-16be", false)
    if (utf16be !== undefined) {
      return {
        content: utf16be,
        encoding: "utf-16be",
      } as const
    }
  }

  const gb18030 = tryDecode("gb18030", false)
  if (gb18030 !== undefined) {
    return {
      content: gb18030,
      encoding: "gb18030",
    } as const
  }

  return {
    content: new TextDecoder("utf-8").decode(bytes),
    encoding: "utf-8",
  } as const
}

const binary = new Set([
  "exe",
  "dll",
  "pdb",
  "bin",
  "so",
  "dylib",
  "o",
  "a",
  "lib",
  "wav",
  "mp3",
  "ogg",
  "oga",
  "ogv",
  "ogx",
  "flac",
  "aac",
  "wma",
  "m4a",
  "weba",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "mkv",
  "zip",
  "tar",
  "gz",
  "gzip",
  "bz",
  "bz2",
  "bzip",
  "bzip2",
  "7z",
  "rar",
  "xz",
  "lz",
  "z",
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "dmg",
  "iso",
  "img",
  "vmdk",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "sqlite",
  "db",
  "mdb",
  "apk",
  "ipa",
  "aab",
  "xapk",
  "app",
  "pkg",
  "deb",
  "rpm",
  "snap",
  "flatpak",
  "appimage",
  "msi",
  "msp",
  "jar",
  "war",
  "ear",
  "class",
  "kotlin_module",
  "dex",
  "vdex",
  "odex",
  "oat",
  "art",
  "wasm",
  "wat",
  "bc",
  "ll",
  "s",
  "ko",
  "sys",
  "drv",
  "efi",
  "rom",
  "com",
])

const image = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "tif",
  "tiff",
  "svg",
  "svgz",
  "avif",
  "apng",
  "jxl",
  "heic",
  "heif",
  "raw",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "raf",
  "pef",
  "x3f",
])

const text = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "mtsx",
  "ctsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "psm1",
  "cmd",
  "bat",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "md",
  "mdx",
  "txt",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "graphql",
  "gql",
  "sql",
  "ini",
  "cfg",
  "conf",
  "env",
])

const textName = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".eslintrc",
])

const mime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  avif: "image/avif",
  apng: "image/apng",
  jxl: "image/jxl",
  heic: "image/heic",
  heif: "image/heif",
}

type Entry = { files: string[]; dirs: string[] }

const ext = (file: string) => path.extname(file).toLowerCase().slice(1)
const name = (file: string) => path.basename(file).toLowerCase()
const isImageByExtension = (file: string) => image.has(ext(file))
const isTextByExtension = (file: string) => text.has(ext(file))
const isTextByName = (file: string) => textName.has(name(file))
const isBinaryByExtension = (file: string) => binary.has(ext(file))
const isImage = (mimeType: string) => mimeType.startsWith("image/")
const getImageMimeType = (file: string) => mime[ext(file)] || "image/" + ext(file)
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const docxTextEntry = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/u

function shouldEncode(mimeType: string) {
  const type = mimeType.toLowerCase()
  log.debug("shouldEncode", { type })
  if (!type) return false
  if (type.startsWith("text/")) return false
  if (type.includes("charset=")) return false
  const top = type.split("/", 2)[0]
  return ["image", "audio", "video", "font", "model", "multipart"].includes(top)
}

function decodeXmlEntities(input: string) {
  return input
    .replace(/&#x([0-9a-f]+);/giu, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/gu, (_, value: string) => String.fromCodePoint(parseInt(value, 10)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
}

function extractDocxXmlText(input: string) {
  return decodeXmlEntities(
    input
      .replace(/<w:tab[^>]*\/>/gu, "\t")
      .replace(/<w:br[^>]*\/>/gu, "\n")
      .replace(/<w:cr[^>]*\/>/gu, "\n")
      .replace(/<\/w:p>/gu, "\n")
      .replace(/<\/w:tr>/gu, "\n")
      .replace(/<\/w:tc>/gu, "\t")
      .replace(/<[^>]+>/gu, ""),
  )
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function extractDocxText(bytes: Uint8Array) {
  const zip = await import("@zip.js/zip.js")
  const buffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : Uint8Array.from(bytes).buffer
  const reader = new zip.ZipReader(new zip.BlobReader(new Blob([buffer], { type: docxMimeType })))

  try {
    const entries = await reader.getEntries()
    const xmlEntries = entries.filter((entry) => docxTextEntry.test(entry.filename) && !!entry.getData)
    if (!xmlEntries.length) return undefined

    const chunks: string[] = []
    for (const entry of xmlEntries) {
      if (!entry.getData) continue
      const xml = await entry.getData(new zip.TextWriter())
      const text = extractDocxXmlText(xml)
      if (text) chunks.push(text)
    }
    if (!chunks.length) return ""
    return chunks.join("\n\n").trim()
  } finally {
    await reader.close().catch(() => undefined)
  }
}

const hidden = (item: string) => {
  const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").some((part) => part.startsWith(".") && part.length > 1)
}

const sortHiddenLast = (items: string[], prefer: boolean) => {
  if (prefer) return items
  const visible: string[] = []
  const hiddenItems: string[] = []
  for (const item of items) {
    if (hidden(item)) hiddenItems.push(item)
    else visible.push(item)
  }
  return [...visible, ...hiddenItems]
}

interface State {
  cache: Entry
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Info[]>
  readonly read: (file: string, options?: { withDiff?: boolean }) => Effect.Effect<Content>
  readonly write: (input: {
    path: string
    content: string
    expectedChecksum?: string
    createParents?: boolean
  }) => Effect.Effect<Content>
  readonly list: (dir?: string) => Effect.Effect<Node[]>
  readonly search: (input: {
    query: string
    limit?: number
    dirs?: boolean
    type?: "file" | "directory"
  }) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/File") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appFs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const git = yield* Git.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("File.state")(() =>
        Effect.succeed({
          cache: { files: [], dirs: [] } as Entry,
        }),
      ),
    )

    const scan = Effect.fn("File.scan")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.directory === path.parse(ctx.directory).root) return
      const isGlobalHome = ctx.directory === Global.Path.home && ctx.project.id === "global"
      const next: Entry = { files: [], dirs: [] }

      if (isGlobalHome) {
        const dirs = new Set<string>()
        const protectedNames = Protected.names()
        const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
        const shouldIgnoreName = (name: string) => name.startsWith(".") || protectedNames.has(name)
        const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)
        const top = yield* appFs.readDirectoryEntries(ctx.directory).pipe(Effect.orElseSucceed(() => []))

        for (const entry of top) {
          if (entry.type !== "directory") continue
          if (shouldIgnoreName(entry.name)) continue
          dirs.add(entry.name + "/")

          const base = path.join(ctx.directory, entry.name)
          const children = yield* appFs.readDirectoryEntries(base).pipe(Effect.orElseSucceed(() => []))
          for (const child of children) {
            if (child.type !== "directory") continue
            if (shouldIgnoreNested(child.name)) continue
            dirs.add(entry.name + "/" + child.name + "/")
          }
        }

        next.dirs = Array.from(dirs).toSorted()
      } else {
        const files = yield* rg.files({ cwd: ctx.directory }).pipe(
          Stream.runCollect,
          Effect.map((chunk) => [...chunk]),
        )
        const seen = new Set<string>()
        for (const file of files) {
          next.files.push(file)
          let current = file
          while (true) {
            const dir = path.dirname(current)
            if (dir === ".") break
            if (dir === current) break
            current = dir
            if (seen.has(dir)) continue
            seen.add(dir)
            next.dirs.push(dir + "/")
          }
        }
      }

      const s = yield* InstanceState.get(state)
      s.cache = next
    })

    let cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))

    const ensure = Effect.fn("File.ensure")(function* () {
      yield* cachedScan
      cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))
    })

    const gitText = Effect.fnUntraced(function* (args: string[]) {
      return (yield* git.run(args, { cwd: (yield* InstanceState.context).directory })).text()
    })

    const init = Effect.fn("File.init")(function* () {
      yield* ensure().pipe(Effect.forkIn(scope))
    })

    const status = Effect.fn("File.status")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") return []

      const items = yield* git.status(ctx.directory)
      const stats = yield* (yield* git.hasHead(ctx.directory))
        ? git.stats(ctx.directory, "HEAD").pipe(
            Effect.map((list) => new Map(list.map((item) => [item.file, item] as const))),
          )
        : Effect.succeed(new Map<string, Git.Stat>())

      const changed = yield* Effect.forEach(items, (item) =>
        Effect.gen(function* () {
          const stat = stats.get(item.file)
          if (item.status === "added") {
            if (stat) {
              return {
                path: item.file,
                added: stat.additions,
                removed: stat.deletions,
                status: item.status,
              } satisfies Info
            }

            const content = yield* appFs
              .readFileString(path.join(ctx.directory, item.file))
              .pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)))
            if (content === undefined) return
            return {
              path: item.file,
              added: content.split("\n").length,
              removed: 0,
              status: item.status,
            } satisfies Info
          }

          return {
            path: item.file,
            added: stat?.additions ?? 0,
            removed: stat?.deletions ?? 0,
            status: item.status,
          } satisfies Info
        }),
      )

      return changed.filter((item): item is Info => Boolean(item)).map((item) => {
        const full = path.isAbsolute(item.path) ? item.path : path.join(ctx.directory, item.path)
        return {
          ...item,
          path: path.relative(ctx.directory, full),
        }
      })
    })

    const read: Interface["read"] = Effect.fn("File.read")(function* (
      file: string,
      options?: { withDiff?: boolean },
    ) {
      using _ = log.time("read", { file })
      const ctx = yield* InstanceState.context
      const full = AppFileSystem.normalizePath(path.isAbsolute(file) ? file : path.join(ctx.directory, file))
      const projectRelative = AppFileSystem.contains(ctx.directory, full) ? path.relative(ctx.directory, full) : undefined

      if (!path.isAbsolute(file) && !Instance.containsPath(full, ctx)) {
        throw new Error("Access denied: path escapes project directory")
      }

      if (isImageByExtension(file)) {
        const exists = yield* appFs.existsSafe(full)
        if (exists) {
          const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
          const content = Buffer.from(bytes).toString("base64")
          return {
            exists: true,
            type: "text" as const,
            content,
            checksum: contentChecksum(content),
            mimeType: getImageMimeType(file),
            encoding: "base64" as const,
          }
        }
        return { exists: false, type: "text" as const, content: "", checksum: contentChecksum("") }
      }

      if (ext(file) === "docx") {
        const exists = yield* appFs.existsSafe(full)
        if (!exists) return { exists: false, type: "text" as const, content: "", checksum: contentChecksum("") }

        const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
        const content = yield* Effect.promise(() => extractDocxText(bytes)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (content !== undefined) {
          return {
            exists: true,
            type: "text" as const,
            content,
            checksum: contentChecksum(content),
            mimeType: docxMimeType,
          }
        }
        return { exists: true, type: "binary" as const, content: "", checksum: contentChecksum(""), mimeType: docxMimeType }
      }

      const knownText = isTextByExtension(file) || isTextByName(file)

      if (isBinaryByExtension(file) && !knownText) {
        return {
          exists: yield* appFs.existsSafe(full),
          type: "binary" as const,
          content: "",
          checksum: contentChecksum(""),
        }
      }

      const exists = yield* appFs.existsSafe(full)
      if (!exists) return { exists: false, type: "text" as const, content: "", checksum: contentChecksum("") }

      const mimeType = AppFileSystem.mimeType(full)
      const encode = knownText ? false : shouldEncode(mimeType)

      if (encode && !isImage(mimeType)) {
        return { exists: true, type: "binary" as const, content: "", checksum: contentChecksum(""), mimeType }
      }

      if (encode) {
        const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
        const content = Buffer.from(bytes).toString("base64")
        return {
          exists: true,
          type: "text" as const,
          content,
          checksum: contentChecksum(content),
          mimeType,
          encoding: "base64" as const,
        }
      }

      const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
      const decoded = decodeTextBytes(bytes)
      const content = decoded.content

      if (options?.withDiff && ctx.project.vcs === "git" && projectRelative) {
        let diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--", projectRelative])
        if (!diff.trim()) {
          diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--staged", "--", projectRelative])
        }
        if (diff.trim()) {
          const original = yield* git.show(ctx.directory, "HEAD", projectRelative)
          const patch = structuredPatch(projectRelative, projectRelative, original, content, "old", "new", {
            context: Infinity,
            ignoreWhitespace: true,
          })
          return { exists: true, type: "text" as const, content, checksum: contentChecksum(content), patch, diff: formatPatch(patch) }
        }
        return { exists: true, type: "text" as const, content, checksum: contentChecksum(content) }
      }

      return { exists: true, type: "text" as const, content, checksum: contentChecksum(content) }
    })

    const write: Interface["write"] = Effect.fn("File.write")(function* (input: {
      path: string
      content: string
      expectedChecksum?: string
      createParents?: boolean
    }) {
      using _ = log.time("write", { file: input.path })
      const ctx = yield* InstanceState.context
      const full = AppFileSystem.normalizePath(
        path.isAbsolute(input.path) ? input.path : path.join(ctx.directory, input.path),
      )

      if (!path.isAbsolute(input.path) && !Instance.containsPath(full, ctx)) {
        throw new Error("Access denied: path escapes project directory")
      }

      const exists = yield* appFs.existsSafe(full)
      if (input.expectedChecksum !== undefined) {
        const current = exists
          ? yield* appFs.readFileString(full).pipe(Effect.catch(() => Effect.succeed("")))
          : ""
        const currentChecksum = contentChecksum(current)
        if (currentChecksum !== input.expectedChecksum) {
          throw new Error(
            `Checksum mismatch for ${input.path}. Expected ${input.expectedChecksum}, received ${currentChecksum}.`,
          )
        }
      }

      if (input.createParents) {
        yield* appFs.makeDirectory(path.dirname(full), { recursive: true }).pipe(Effect.orDie)
      }

      yield* appFs.writeFileString(full, input.content).pipe(Effect.orDie)
      return {
        exists: true,
        type: "text" as const,
        content: input.content,
        checksum: contentChecksum(input.content),
      }
    })

    const list = Effect.fn("File.list")(function* (dir?: string) {
      const ctx = yield* InstanceState.context
      const exclude = [".git", ".DS_Store"]
      let ignored = (_: string) => false
      if (ctx.project.vcs === "git") {
        const ig = ignore()
        const gitignore = path.join(ctx.worktree, ".gitignore")
        const gitignoreText = yield* appFs.readFileString(gitignore).pipe(Effect.catch(() => Effect.succeed("")))
        if (gitignoreText) ig.add(gitignoreText)
        const ignoreFile = path.join(ctx.worktree, ".ignore")
        const ignoreText = yield* appFs.readFileString(ignoreFile).pipe(Effect.catch(() => Effect.succeed("")))
        if (ignoreText) ig.add(ignoreText)
        ignored = ig.ignores.bind(ig)
      }

      const resolved = dir ? path.join(ctx.directory, dir) : ctx.directory
      if (!Instance.containsPath(resolved, ctx)) {
        throw new Error("Access denied: path escapes project directory")
      }

      const entries = yield* appFs.readDirectoryEntries(resolved).pipe(Effect.orElseSucceed(() => []))

      const nodes: Node[] = []
      for (const entry of entries) {
        if (exclude.includes(entry.name)) continue
        const absolute = path.join(resolved, entry.name)
        const file = path.relative(ctx.directory, absolute)
        const type = entry.type === "directory" ? "directory" : "file"
        nodes.push({
          name: entry.name,
          path: file,
          absolute,
          type,
          ignored: ignored(type === "directory" ? file + "/" : file),
        })
      }
      return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    })

    const search = Effect.fn("File.search")(function* (input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }) {
      yield* ensure()
      const { cache } = yield* InstanceState.get(state)

      const query = input.query.trim()
      const limit = input.limit ?? 100
      const kind = input.type ?? (input.dirs === false ? "file" : "all")
      log.info("search", { query, kind })

      const preferHidden = query.startsWith(".") || query.includes("/.")

      if (!query) {
        if (kind === "file") return cache.files.slice(0, limit)
        return sortHiddenLast(cache.dirs.toSorted(), preferHidden).slice(0, limit)
      }

      const items = kind === "file" ? cache.files : kind === "directory" ? cache.dirs : [...cache.files, ...cache.dirs]

      const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
      const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((item) => item.target)
      const output = kind === "directory" ? sortHiddenLast(sorted, preferHidden).slice(0, limit) : sorted

      log.info("search", { query, kind, results: output.length })
      return output
    })

    log.info("init")
    return Service.of({ init, status, read, write, list, search })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Git.defaultLayer),
)

export * as File from "."

