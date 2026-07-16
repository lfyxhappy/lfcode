import { afterAll, afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as fs from "fs/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ReplaceRangeTool } from "../../src/tool/replace_range"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { AppFileSystem } from "@/filesystem"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Truncate } from "../../src/tool"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { contentVersion } from "../../src/tool/patch-recovery"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const baseCtx = {
  sessionID: SessionID.make("ses_test-replace-range"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: {
    diff: string
    filepath: string
    files: Array<{
      filePath: string
      relativePath: string
      type: "add" | "update" | "delete" | "move"
      patch: string
      additions: number
      deletions: number
      movePath?: string
    }>
  }
}

type ToolCtx = typeof baseCtx & {
  ask: (input: AskInput) => Effect.Effect<void>
}

const execute = async (
  params: {
    filePath: string
    startLine: number
    startChar?: number
    endLine: number
    endChar?: number
    newText: string
    expected_version?: string
  },
  ctx: ToolCtx,
) => {
  const info = await runtime.runPromise(ReplaceRangeTool)
  const tool = await runtime.runPromise(info.init())
  return Effect.runPromise(tool.execute(params, ctx))
}

const makeCtx = () => {
  const calls: AskInput[] = []
  const ctx: ToolCtx = {
    ...baseCtx,
    ask: (input) =>
      Effect.sync(() => {
        calls.push(input)
      }),
  }

  return { ctx, calls }
}

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(async () => {
  await runtime.dispose()
})

describe("tool.replace_range", () => {
  test("replaces a character range within one line", async () => {
    await using fixture = await tmpdir()
    const { ctx, calls } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "single.txt")
        await fs.writeFile(target, "hello world\n", "utf-8")

        const result = await execute(
          {
            filePath: target,
            startLine: 1,
            startChar: 7,
            endLine: 1,
            endChar: 12,
            newText: "lfcode",
          },
          ctx,
        )

        expect(result.output).toContain("Success. Updated the following files")
        expect(await fs.readFile(target, "utf-8")).toBe("hello lfcode\n")
        expect(calls).toHaveLength(1)
      },
    })
  })

  test("replaces whole lines when characters are omitted", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "multiline.txt")
        await fs.writeFile(target, "alpha\nbeta\ngamma\ndelta\n", "utf-8")

        await execute(
          {
            filePath: target,
            startLine: 2,
            endLine: 3,
            newText: "BETA\nGAMMA",
          },
          ctx,
        )

        expect(await fs.readFile(target, "utf-8")).toBe("alpha\nBETA\nGAMMA\ndelta\n")
      },
    })
  })

  test("supports multi-line partial replacements", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "partial.txt")
        await fs.writeFile(target, "alpha\nbeta\ngamma\n", "utf-8")

        await execute(
          {
            filePath: target,
            startLine: 1,
            startChar: 3,
            endLine: 2,
            endChar: 3,
            newText: "Z\nY",
          },
          ctx,
        )

        expect(await fs.readFile(target, "utf-8")).toBe("alZ\nYta\ngamma\n")
      },
    })
  })

  test("preserves CRLF line endings", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "crlf.txt")
        await fs.writeFile(target, "line1\r\nline2\r\n", "utf-8")

        await execute(
          {
            filePath: target,
            startLine: 2,
            endLine: 2,
            newText: "changed",
          },
          ctx,
        )

        expect(await fs.readFile(target, "utf-8")).toBe("line1\r\nchanged\r\n")
      },
    })
  })

  test("supports inserting into an empty file", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "empty.txt")
        await fs.writeFile(target, "", "utf-8")

        await execute(
          {
            filePath: target,
            startLine: 1,
            startChar: 1,
            endLine: 1,
            endChar: 1,
            newText: "seed",
          },
          ctx,
        )

        expect(await fs.readFile(target, "utf-8")).toBe("seed\n")
      },
    })
  })

  test("rejects out-of-bounds positions", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "bounds.txt")
        await fs.writeFile(target, "abc\n", "utf-8")

        await expect(
          execute(
            {
              filePath: target,
              startLine: 1,
              startChar: 5,
              endLine: 1,
              endChar: 5,
              newText: "x",
            },
            ctx,
          ),
        ).rejects.toThrow("startChar 5 exceeds line 1 length 3")
      },
    })
  })

  test("rejects no-op replacements", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "noop.txt")
        await fs.writeFile(target, "same\n", "utf-8")

        await expect(
          execute(
            {
              filePath: target,
              startLine: 1,
              endLine: 1,
              newText: "same",
            },
            ctx,
          ),
        ).rejects.toThrow("No changes to apply.")
      },
    })
  })

  test("rejects a stale read version before editing", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "stale.txt")
        await fs.writeFile(target, "alpha\n", "utf-8")
        const oldVersion = contentVersion(new TextEncoder().encode("alpha\n"))
        await fs.writeFile(target, "beta\n", "utf-8")

        await expect(
          execute(
            {
              filePath: target,
              startLine: 1,
              endLine: 1,
              newText: "gamma",
              expected_version: oldVersion,
            },
            ctx,
          ),
        ).rejects.toThrow("Read the target file again")
        expect(await fs.readFile(target, "utf-8")).toBe("beta\n")
      },
    })
  })
})
