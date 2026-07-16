import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ArchiveInspectTool } from "../../src/tool/archive_inspect"
import { Tool, Truncate } from "../../src/tool"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer),
)

const init = Effect.fn("ArchiveInspectToolTest.init")(function* () {
  const info = yield* ArchiveInspectTool
  return yield* info.init()
})

const run = Effect.fn("ArchiveInspectToolTest.run")(function* (
  args: Tool.InferParameters<typeof ArchiveInspectTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const exec = Effect.fn("ArchiveInspectToolTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ArchiveInspectTool>,
  next: Tool.Context = ctx,
) {
  return yield* provideInstance(dir)(run(args, next))
})

const put = Effect.fn("ArchiveInspectToolTest.put")(function* (p: string, content: string | Buffer | Uint8Array) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(p, content)
})

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

describe("tool.archive_inspect", () => {
  it.live("lists zip archive entries", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "sample.zip")
      const zip = yield* Effect.promise(() => import("@zip.js/zip.js"))
      const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
      yield* Effect.promise(() => writer.add("docs/readme.txt", new zip.TextReader("hello")))
      yield* Effect.promise(() => writer.add("src/index.ts", new zip.TextReader("export {}")))
      const blob = yield* Effect.promise(() => writer.close())
      yield* put(filepath, new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer())))

      const result = yield* exec(dir, { filePath: filepath, mode: "list" })
      expect(result.output).toContain("<entries>")
      expect(result.output).toContain("docs/readme.txt")
      expect(result.output).toContain("src/index.ts")
      expect(result.metadata.entryCount).toBe(2)
    }),
  )

  it.live("extracts text from docx archives", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "sample.docx")
      const zip = yield* Effect.promise(() => import("@zip.js/zip.js"))
      const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
      yield* Effect.promise(() =>
        writer.add(
          "word/document.xml",
          new zip.TextReader(
            `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello docx</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>`,
          ),
        ),
      )
      const blob = yield* Effect.promise(() => writer.close())
      yield* put(filepath, new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer())))

      const result = yield* exec(dir, { filePath: filepath, mode: "extract-text" })
      expect(result.output).toContain("<content>")
      expect(result.output).toContain("Hello docx")
      expect(result.output).toContain("Second line")
      expect(result.metadata.kind).toBe("document")
    }),
  )

  it.live("summarizes archive preview and asks for read permission", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const filepath = path.join(dir, "sample.zip")
      const zip = yield* Effect.promise(() => import("@zip.js/zip.js"))
      const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
      yield* Effect.promise(() => writer.add("docs/readme.txt", new zip.TextReader("hello")))
      yield* Effect.promise(() => writer.add("docs/changelog.txt", new zip.TextReader("world")))
      const blob = yield* Effect.promise(() => writer.close())
      yield* put(filepath, new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer())))

      const { items, next } = asks()
      const result = yield* exec(dir, { filePath: filepath }, next)
      expect(result.output).toContain("<entry-preview>")
      expect(result.output).toContain("<entries>2</entries>")
      const read = items.find((item) => item.permission === "read")
      expect(read).toBeDefined()
      expect(read!.patterns).toEqual([filepath])
    }),
  )
})
