import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as fs from "fs/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import { SymbolEditTool } from "../../src/tool/symbol_edit"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { AppFileSystem } from "@/filesystem"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Truncate } from "../../src/tool"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const baseCtx = {
  sessionID: SessionID.make("ses_test-symbol-edit"),
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

function makeRuntime(symbols: Array<LSP.DocumentSymbol | LSP.Symbol>) {
  const lspStub = Layer.succeed(
    LSP.Service,
    LSP.Service.of({
      init: () => Effect.void,
      status: () => Effect.succeed([]),
      hasClients: () => Effect.succeed(true),
      touchFile: () => Effect.void,
      syncFile: () => Effect.void,
      diagnostics: () => Effect.succeed({}),
      hover: () => Effect.succeed([]),
      completion: () => Effect.succeed(undefined),
    signatureHelp: () => Effect.succeed(undefined),
    prepareRename: () => Effect.succeed(undefined),
    rename: () => Effect.succeed(undefined),
    formatting: () => Effect.succeed([]),
    rangeFormatting: () => Effect.succeed([]),
    codeAction: () => Effect.succeed([]),
    executeCommand: () => Effect.succeed(undefined),
    declaration: () => Effect.succeed([]),
      definition: () => Effect.succeed([]),
      typeDefinition: () => Effect.succeed([]),
      references: () => Effect.succeed([]),
      implementation: () => Effect.succeed([]),
      documentHighlights: () => Effect.succeed([]),
      documentSymbol: () => Effect.succeed(symbols),
      workspaceSymbol: () => Effect.succeed([]),
      prepareCallHierarchy: () => Effect.succeed([]),
      incomingCalls: () => Effect.succeed([]),
      outgoingCalls: () => Effect.succeed([]),
    }),
  )

  return ManagedRuntime.make(
    Layer.mergeAll(
      lspStub,
      AppFileSystem.defaultLayer,
      Format.defaultLayer,
      Bus.layer,
      Truncate.defaultLayer,
      Agent.defaultLayer,
    ),
  )
}

const execute = async (
  runtime: ManagedRuntime.ManagedRuntime<any, never>,
  params: {
    filePath: string
    symbol?: string
    symbolPath?: string
    mode?: "replace" | "before" | "after"
    newText: string
  },
  ctx: ToolCtx,
) => {
  const info = await runtime.runPromise(SymbolEditTool)
  const tool = await runtime.runPromise(info.init())
  return Effect.runPromise(tool.execute(params, ctx))
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.symbol_edit", () => {
  test("replaces a symbol selected by name", async () => {
    await using fixture = await tmpdir()
    const runtime = makeRuntime([
      {
        name: "alpha",
        kind: 12,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 1 },
        },
        selectionRange: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 14 },
        },
      },
    ])
    const { ctx, calls } = makeCtx()

    try {
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const target = path.join(fixture.path, "sample.ts")
          await fs.writeFile(target, "function alpha() {\n  return 1\n}\n\nconst untouched = true\n", "utf-8")

          const result = await execute(
            runtime,
            {
              filePath: target,
              symbol: "alpha",
              newText: "function alpha() {\n  return 42\n}",
            },
            ctx,
          )

          expect(result.title).toBe("replace alpha")
          expect(result.metadata.symbol.selector).toBe("alpha")
          expect(await fs.readFile(target, "utf-8")).toBe("function alpha() {\n  return 42\n}\n\nconst untouched = true\n")
          expect(calls).toHaveLength(1)
        },
      })
    } finally {
      await runtime.dispose()
    }
  })

  test("uses symbolPath to disambiguate duplicate names", async () => {
    await using fixture = await tmpdir()
    const runtime = makeRuntime([
      {
        name: "run",
        kind: 6,
        location: {
          uri: "file:///ignored",
          range: {
            start: { line: 1, character: 2 },
            end: { line: 3, character: 4 },
          },
        },
      },
      {
        name: "run",
        kind: 6,
        location: {
          uri: "file:///ignored",
          range: {
            start: { line: 7, character: 2 },
            end: { line: 9, character: 4 },
          },
        },
      },
      {
        name: "run",
        detail: "worker",
        kind: 6,
        range: {
          start: { line: 7, character: 2 },
          end: { line: 9, character: 4 },
        },
        selectionRange: {
          start: { line: 7, character: 2 },
          end: { line: 7, character: 5 },
        },
      },
    ])
    const { ctx } = makeCtx()

    try {
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const target = path.join(fixture.path, "object.ts")
          await fs.writeFile(
            target,
            [
              "const api = {",
              "  run() {",
              '    return "api"',
              "  },",
              "}",
              "",
              "const worker = {",
              "  run() {",
              '    return "worker"',
              "  },",
              "}",
              "",
            ].join("\n"),
            "utf-8",
          )

          await execute(
            runtime,
            {
              filePath: target,
              symbolPath: "worker.run",
              newText: 'run() {\n    return "changed"\n  },',
            },
            ctx,
          )

          expect(await fs.readFile(target, "utf-8")).toContain('const api = {\n  run() {\n    return "api"\n  },\n}')
          expect(await fs.readFile(target, "utf-8")).toContain('const worker = {\n  run() {\n    return "changed"\n  },\n}')
        },
      })
    } finally {
      await runtime.dispose()
    }
  })

  test("reports ambiguity when duplicate symbol names exist", async () => {
    await using fixture = await tmpdir()
    const runtime = makeRuntime([
      {
        name: "run",
        detail: "api",
        kind: 6,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 3, character: 4 },
        },
        selectionRange: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 5 },
        },
      },
      {
        name: "run",
        detail: "worker",
        kind: 6,
        range: {
          start: { line: 7, character: 2 },
          end: { line: 9, character: 4 },
        },
        selectionRange: {
          start: { line: 7, character: 2 },
          end: { line: 7, character: 5 },
        },
      },
    ])
    const { ctx } = makeCtx()

    try {
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const target = path.join(fixture.path, "ambiguous.ts")
          await fs.writeFile(target, "const placeholder = true\n", "utf-8")

          await expect(
            execute(
              runtime,
              {
                filePath: target,
                symbol: "run",
                newText: "noop",
              },
              ctx,
            ),
          ).rejects.toThrow("Provide symbolPath to disambiguate")
        },
      })
    } finally {
      await runtime.dispose()
    }
  })
})
