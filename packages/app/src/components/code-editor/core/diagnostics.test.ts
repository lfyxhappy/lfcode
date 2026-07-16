import { describe, expect, test } from "bun:test"
import { collectCodeEditorDiagnostics, suppressBrowserOnlyModuleResolutionDiagnostics } from "./diagnostics"

describe("collectCodeEditorDiagnostics", () => {
  test("filters to errors and warnings, then sorts by severity and position", () => {
    const result = collectCodeEditorDiagnostics({
      monaco: {
        MarkerSeverity: {
          Error: 8,
          Warning: 4,
          Info: 2,
        },
        editor: {
          getModelMarkers: () => [
            {
              severity: 4,
              message: "warning later",
              startLineNumber: 3,
              startColumn: 2,
              endLineNumber: 3,
              endColumn: 6,
            },
            {
              severity: 8,
              message: "error first",
              startLineNumber: 1,
              startColumn: 5,
              endLineNumber: 1,
              endColumn: 9,
              source: "ts",
              code: "2322",
            },
            {
              severity: 2,
              message: "info ignored",
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 2,
            },
            {
              severity: 8,
              message: "error second",
              startLineNumber: 2,
              startColumn: 1,
              endLineNumber: 2,
              endColumn: 4,
            },
          ],
        },
      } as any,
      model: { uri: "file:///demo.ts" } as any,
    })

    expect(result.errors).toBe(2)
    expect(result.warnings).toBe(1)
    expect(result.items.map((item) => item.message)).toEqual(["error first", "error second", "warning later"])
    expect(result.items[0]).toMatchObject({
      severity: "error",
      line: 1,
      column: 5,
      source: "ts",
      code: "2322",
    })
  })
})

describe("suppressBrowserOnlyModuleResolutionDiagnostics", () => {
  test("removes only browser-worker module resolution noise from Lfcode editor models", () => {
    const model = { uri: { scheme: "lfcode-editor" } }
    const markers = [
      {
        owner: "typescript",
        code: "2792",
        severity: 8,
        message: "Cannot find module '@/shared'",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 10,
      },
      {
        owner: "typescript",
        code: "2322",
        severity: 8,
        message: "Type mismatch",
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 10,
      },
      {
        owner: "lfcode-lsp",
        code: "2307",
        severity: 8,
        message: "Actual project diagnostic",
        startLineNumber: 3,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 10,
      },
    ]
    const writes: Array<{ owner: string; markers: unknown[] }> = []
    const monaco = {
      editor: {
        getModelMarkers: () => markers,
        setModelMarkers: (_model: unknown, owner: string, next: unknown[]) => writes.push({ owner, markers: next }),
      },
    }

    expect(suppressBrowserOnlyModuleResolutionDiagnostics({ monaco: monaco as never, model: model as never })).toBe(true)
    expect(writes).toEqual([
      {
        owner: "typescript",
        markers: [
          expect.objectContaining({ code: "2322", message: "Type mismatch" }),
        ],
      },
    ])
  })
})
