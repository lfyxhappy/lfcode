import { describe, expect, test } from "bun:test"
import {
  getCodeEditorServerLspRegistryKey,
  getCodeEditorServerLspCompletionCacheKey,
  getCodeEditorServerLspCompletionTriggerCharacters,
  getCodeEditorFilePathFromUri,
  shouldAcceptCodeEditorCompletionResult,
  shouldAcceptCodeEditorServerLspResult,
  shouldUseCodeEditorServerLsp,
} from "./server-lsp"

describe("code editor server LSP", () => {
  test("maps the editor memory URI back to its Windows file path", () => {
    expect(getCodeEditorFilePathFromUri("lfcode-editor://model/C:/workspace/demo/main.py")).toBe(
      "C:/workspace/demo/main.py",
    )
  })

  test("maps file URIs back to their file path", () => {
    expect(getCodeEditorFilePathFromUri("file:///C:/workspace/demo/main.cpp")).toBe("C:/workspace/demo/main.cpp")
  })

  test("rejects completion results after cancellation or a document revision change", () => {
    expect(shouldAcceptCodeEditorCompletionResult({ aborted: false, expectedVersion: 12, currentVersion: 12 })).toBe(true)
    expect(shouldAcceptCodeEditorCompletionResult({ aborted: true, expectedVersion: 12, currentVersion: 12 })).toBe(false)
    expect(shouldAcceptCodeEditorCompletionResult({ aborted: false, expectedVersion: 12, currentVersion: 13 })).toBe(false)
  })

  test("shares provider registrations by endpoint, directory, and language rather than file path", () => {
    const keys = ["C:/workspace/main.ts", "C:/workspace/other.ts"].map(() =>
      getCodeEditorServerLspRegistryKey({
        serverURL: "http://127.0.0.1:4096",
        directory: "C:/workspace",
        language: "typescript",
      }),
    )
    const otherLanguage = getCodeEditorServerLspRegistryKey({
      serverURL: "http://127.0.0.1:4096",
      directory: "C:/workspace",
      language: "python",
    })

    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).not.toContain("main.ts")
    expect(keys[0]).not.toBe(otherLanguage)
  })

  test("only shares completion work for the same document revision, cursor, and trigger", () => {
    const binding = {
      stamp: { key: "lfcode-editor://model/C:/workspace/main.ts", revision: 4, modelVersion: 12 },
    }
    const base = {
      binding,
      query: {
        kind: "completion" as const,
        position: { lineNumber: 3, column: 9 },
        triggerCharacter: ".",
        maxItems: 200,
      },
    }
    expect(getCodeEditorServerLspCompletionCacheKey(base)).toBe(getCodeEditorServerLspCompletionCacheKey(base))
    expect(
      getCodeEditorServerLspCompletionCacheKey({
        ...base,
        query: { ...base.query, position: { lineNumber: 3, column: 10 } },
      }),
    ).not.toBe(getCodeEditorServerLspCompletionCacheKey(base))
    expect(
      getCodeEditorServerLspCompletionCacheKey({
        ...base,
        binding: { stamp: { ...binding.stamp, revision: 5 } },
      }),
    ).not.toBe(getCodeEditorServerLspCompletionCacheKey(base))
  })

  test("uses advertised LSP completion triggers and falls back before a server connects", () => {
    expect(getCodeEditorServerLspCompletionTriggerCharacters([":", ".", ":"])).toEqual([":", "."])
    expect(getCodeEditorServerLspCompletionTriggerCharacters()).toContain(".")
  })

  test("rejects provider results after a revision, model version, or path binding changes", () => {
    const stamp = { key: "lfcode-editor://model/C:/workspace/main.ts", revision: 4, modelVersion: 12 }
    const accepted = {
      aborted: false,
      expectedVersion: 12,
      currentVersion: 12,
      expectedPath: "C:/workspace/main.ts",
      currentPath: "C:/workspace/main.ts",
      pathIsRegistered: true,
      expectedStamp: stamp,
      currentStamp: stamp,
    }

    expect(shouldAcceptCodeEditorServerLspResult(accepted)).toBe(true)
    expect(
      shouldAcceptCodeEditorServerLspResult({
        ...accepted,
        currentStamp: { ...stamp, revision: 5 },
      }),
    ).toBe(false)
    expect(shouldAcceptCodeEditorServerLspResult({ ...accepted, currentVersion: 13 })).toBe(false)
    expect(shouldAcceptCodeEditorServerLspResult({ ...accepted, currentPath: "C:/workspace/other.ts" })).toBe(false)
    expect(shouldAcceptCodeEditorServerLspResult({ ...accepted, pathIsRegistered: false })).toBe(false)
  })

  test("uses the server LSP for project-aware TypeScript and JavaScript semantics", () => {
    expect(shouldUseCodeEditorServerLsp("typescript")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("javascript")).toBe(true)
  })

  test("uses the server LSP for managed language runtimes with Monaco support", () => {
    expect(shouldUseCodeEditorServerLsp("go")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("rust")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("java")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("yaml")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("shell")).toBe(true)
  })
})
