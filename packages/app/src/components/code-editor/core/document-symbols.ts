import type { languages } from "monaco-editor"
import type { CodeEditorDocumentSymbolItem } from "@/components/code-editor/core/command-handle"

type MonacoSymbolInformation = {
  name: string
  containerName?: string
  location: {
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  }
}

export function flattenCodeEditorDocumentSymbols(input: unknown) {
  if (!Array.isArray(input)) return []

  if (input.every(isDocumentSymbol)) {
    let index = 0
    return input.flatMap((symbol) => flattenDocumentSymbol(symbol, 0, () => String(index++)))
  }

  if (input.every(isSymbolInformation)) {
    return input.map((symbol, index) => ({
      id: String(index),
      label: symbol.name,
      detail: symbol.containerName,
      depth: 0,
      selection: {
        startLineNumber: symbol.location.range.startLineNumber,
        startColumn: symbol.location.range.startColumn,
        endLineNumber: symbol.location.range.endLineNumber,
        endColumn: symbol.location.range.endColumn,
      },
      range: {
        startLineNumber: symbol.location.range.startLineNumber,
        startColumn: symbol.location.range.startColumn,
        endLineNumber: symbol.location.range.endLineNumber,
        endColumn: symbol.location.range.endColumn,
      },
    })) satisfies CodeEditorDocumentSymbolItem[]
  }

  return []
}

function flattenDocumentSymbol(symbol: languages.DocumentSymbol, depth: number, nextID: () => string): CodeEditorDocumentSymbolItem[] {
  return [
    {
      id: nextID(),
      label: symbol.name,
      detail: symbol.detail,
      depth,
      selection: {
        startLineNumber: symbol.selectionRange.startLineNumber,
        startColumn: symbol.selectionRange.startColumn,
        endLineNumber: symbol.selectionRange.endLineNumber,
        endColumn: symbol.selectionRange.endColumn,
      },
      range: {
        startLineNumber: symbol.range.startLineNumber,
        startColumn: symbol.range.startColumn,
        endLineNumber: symbol.range.endLineNumber,
        endColumn: symbol.range.endColumn,
      },
    },
    ...(symbol.children ?? []).flatMap((child) => flattenDocumentSymbol(child, depth + 1, nextID)),
  ]
}

function isDocumentSymbol(value: unknown): value is languages.DocumentSymbol {
  if (!value || typeof value !== "object") return false
  if (!("selectionRange" in value) || !("children" in value)) return false
  return Array.isArray(value.children)
}

function isSymbolInformation(value: unknown): value is MonacoSymbolInformation {
  if (!value || typeof value !== "object") return false
  if (!("location" in value) || !("name" in value)) return false
  return typeof value.name === "string"
}
