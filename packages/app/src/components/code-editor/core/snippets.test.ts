import { describe, expect, test } from "bun:test"
import {
  parseCodeEditorSnippetFiles,
  registerCodeEditorSnippetProvider,
  type CodeEditorSnippetFile,
} from "./snippets"

describe("code editor snippets", () => {
  test("loads VS Code JSONC snippets for the matching language", () => {
    expect(
      parseCodeEditorSnippetFiles({
        language: "typescript",
        files: [
          {
            path: "C:/Users/liangfeng/.lfcode/snippets/typescript.json",
            content: `{
              // User snippets may contain comments.
              "log": {
                "prefix": ["log", "clog"],
                "body": ["console.log(${"${1:value}"});", "$0"],
                "description": "Log a value"
              }
            }`,
          },
        ],
      }),
    ).toEqual([
      {
        label: "log",
        prefix: "log",
        body: "console.log(${1:value});\n$0",
        description: "Log a value",
      },
      {
        label: "log",
        prefix: "clog",
        body: "console.log(${1:value});\n$0",
        description: "Log a value",
      },
    ])
  })

  test("filters scoped snippets that do not match the editor language", () => {
    expect(
      parseCodeEditorSnippetFiles({
        language: "python",
        files: [
          {
            path: "C:/project/.lfcode/snippets/global.code-snippets",
            content: JSON.stringify({
              reactOnly: {
                scope: "typescriptreact, javascriptreact",
                prefix: "component",
                body: "export function ${1:Component}() {}",
              },
            }),
          },
        ],
      }),
    ).toEqual([])
  })

  test("shares one provider and snippet cache across documents in a workspace language", async () => {
    const runtime = createSnippetTestRuntime()
    let loads = 0
    const loadFiles = async () => {
      loads += 1
      return [snippetFile]
    }
    const first = registerCodeEditorSnippetProvider({
      monaco: runtime.monaco,
      directory: "C:/workspace",
      path: "C:/workspace/first.ts",
      language: "typescript",
      loadFiles,
    })
    const second = registerCodeEditorSnippetProvider({
      monaco: runtime.monaco,
      directory: "C:/workspace",
      path: "C:/workspace/second.ts",
      language: "typescript",
      loadFiles,
    })
    const duplicateFirst = registerCodeEditorSnippetProvider({
      monaco: runtime.monaco,
      directory: "C:/workspace",
      path: "C:/workspace/first.ts",
      language: "typescript",
      loadFiles,
    })

    expect(runtime.registrations()).toBe(1)
    expect((await runtime.complete("C:/workspace/first.ts")).suggestions).toHaveLength(1)
    expect((await runtime.complete("C:/workspace/second.ts")).suggestions).toHaveLength(1)
    expect((await runtime.complete("C:/workspace/unregistered.ts")).suggestions).toHaveLength(0)
    expect(loads).toBe(1)

    first.dispose()
    expect((await runtime.complete("C:/workspace/first.ts")).suggestions).toHaveLength(1)
    duplicateFirst.dispose()
    expect((await runtime.complete("C:/workspace/first.ts")).suggestions).toHaveLength(0)
    expect((await runtime.complete("C:/workspace/second.ts")).suggestions).toHaveLength(1)
    expect(runtime.disposals()).toBe(0)

    second.dispose()
    second.dispose()
    await Promise.resolve()
    expect(runtime.disposals()).toBe(1)
  })

  test("drops snippet results after cancellation or a model version change", async () => {
    const runtime = createSnippetTestRuntime()
    let resolveFiles!: (files: CodeEditorSnippetFile[]) => void
    const release = registerCodeEditorSnippetProvider({
      monaco: runtime.monaco,
      directory: "C:/stale-workspace",
      path: "C:/stale-workspace/file.ts",
      language: "typescript",
      loadFiles: () => new Promise((resolve) => (resolveFiles = resolve)),
    })
    const model = runtime.model("C:/stale-workspace/file.ts")
    const stale = runtime.completeModel(model)
    model.bumpVersion()
    resolveFiles([snippetFile])
    expect((await stale).suggestions).toHaveLength(0)

    const token = runtime.token()
    const canceled = runtime.completeModel(model, token)
    token.cancel()
    expect((await canceled).suggestions).toHaveLength(0)
    release.dispose()
    await Promise.resolve()
  })
})

const snippetFile = {
  path: "C:/snippets/typescript.json",
  content: JSON.stringify({
    log: {
      prefix: "log",
      body: "console.log($1)",
    },
  }),
}

function createSnippetTestRuntime() {
  let provider: import("monaco-editor").languages.CompletionItemProvider | undefined
  let registrationCount = 0
  let disposalCount = 0
  const monaco = {
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    languages: {
      CompletionItemKind: { Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (
        _language: string,
        next: import("monaco-editor").languages.CompletionItemProvider,
      ) => {
        registrationCount += 1
        provider = next
        return {
          dispose: () => {
            disposalCount += 1
          },
        }
      },
    },
  } as unknown as typeof import("monaco-editor")

  const model = (path: string) => {
    let version = 1
    const value = {
      uri: { toString: () => `lfcode-editor://model/${path}` },
      getVersionId: () => version,
      isDisposed: () => false,
      getWordUntilPosition: () => ({ word: "log", startColumn: 1, endColumn: 4 }),
      bumpVersion: () => {
        version += 1
      },
    }
    return value
  }

  const token = () => {
    const value = {
      isCancellationRequested: false,
      cancel: () => {
        value.isCancellationRequested = true
      },
    }
    return value
  }

  const completeModel = async (
    value: ReturnType<typeof model>,
    cancellation = token(),
  ) => {
    if (!provider) throw new Error("Snippet provider was not registered")
    const result = await provider.provideCompletionItems(
      value as unknown as import("monaco-editor").editor.ITextModel,
      { lineNumber: 1, column: 4 } as unknown as import("monaco-editor").Position,
      { triggerKind: 0 },
      cancellation as unknown as import("monaco-editor").CancellationToken,
    )
    if (!result) throw new Error("Snippet provider returned no result")
    return result
  }

  return {
    monaco,
    model,
    token,
    completeModel,
    complete: (path: string) => completeModel(model(path)),
    registrations: () => registrationCount,
    disposals: () => disposalCount,
  }
}
