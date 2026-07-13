import { describe, expect, test } from "bun:test"
import {
  getCodeEditorFilePathFromUri,
  shouldAcceptCodeEditorCompletionResult,
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

  test("uses the server LSP for project-aware TypeScript and JavaScript semantics", () => {
    expect(shouldUseCodeEditorServerLsp("typescript")).toBe(true)
    expect(shouldUseCodeEditorServerLsp("javascript")).toBe(true)
  })
})
