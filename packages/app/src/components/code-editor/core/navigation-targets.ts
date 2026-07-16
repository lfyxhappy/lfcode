import type { editor } from "monaco-editor"
import type { CodeEditorNavigationSelection } from "@/components/code-editor/core/navigation"
import { normalizeCodeEditorNavigationPath } from "@/components/code-editor/core/navigation"

export type CodeEditorNavigationTargetItem = {
  id: string
  path: string
  label: string
  detail: string
  selection: CodeEditorNavigationSelection
}

type MonacoDocumentHighlightLike = {
  range?: MonacoRangeLike
}

type MonacoRangeLike = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

type MonacoUriLike = {
  fsPath?: string
  path?: string
  toString(): string
}

type MonacoLocationLike = {
  uri?: MonacoUriLike
  range?: MonacoRangeLike
  targetUri?: MonacoUriLike
  targetRange?: MonacoRangeLike
  targetSelectionRange?: MonacoRangeLike
}

type WorkspaceSymbolLike = {
  name?: string
  containerName?: string
  location?: {
    uri?: string
    range?: {
      start?: { line?: number; character?: number }
      end?: { line?: number; character?: number }
    }
  }
}

type CallHierarchyRange = {
  start?: { line?: number; character?: number }
  end?: { line?: number; character?: number }
}

type CallHierarchyItemLike = {
  name?: string
  detail?: string
  uri?: string
  range?: CallHierarchyRange
  selectionRange?: CallHierarchyRange
}

type IncomingCallLike = {
  from?: CallHierarchyItemLike
  fromRanges?: CallHierarchyRange[]
}

type OutgoingCallLike = {
  to?: CallHierarchyItemLike
  fromRanges?: CallHierarchyRange[]
}

export function normalizeCodeEditorNavigationTargets(input: {
  currentPath: string
  currentModel: editor.ITextModel
  result: unknown
}) {
  const currentPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()

  for (const item of normalizeMonacoLocations(input.result)) {
    const uri = item.targetUri ?? item.uri
    const range = item.targetSelectionRange ?? item.targetRange ?? item.range
    const path = uri?.toString() === input.currentModel.uri.toString() ? input.currentPath : getPathFromUri(uri) ?? input.currentPath
    if (!range) continue

    const normalizedPath = normalizeCodeEditorNavigationPath(path)
    const line = range.startLineNumber
    const column = range.startColumn
    const key = `${normalizedPath}:${line}:${column}:${range.endLineNumber}:${range.endColumn}`
    if (deduped.has(key)) continue

    const label = `${getPathBaseName(path)}:${line}`
    const detail = getNavigationDetail({
      currentPath,
      currentModel: input.currentModel,
      path,
      normalizedPath,
      line,
      column,
    })

    deduped.set(key, {
      id: key,
      path,
      label,
      detail,
      selection: {
        startLineNumber: range.startLineNumber,
        startColumn: range.startColumn,
        endLineNumber: range.endLineNumber,
        endColumn: range.endColumn,
      },
    })
  }

  return Array.from(deduped.values())
}

export function normalizeCodeEditorDocumentHighlights(input: {
  currentPath: string
  currentModel: editor.ITextModel
  result: unknown
}) {
  const normalizedPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()

  for (const item of normalizeMonacoDocumentHighlights(input.result)) {
    if (!item.range) continue
    const line = item.range.startLineNumber
    const column = item.range.startColumn
    const key = `${normalizedPath}:${line}:${column}:${item.range.endLineNumber}:${item.range.endColumn}`
    if (deduped.has(key)) continue

    deduped.set(key, {
      id: key,
      path: input.currentPath,
      label: `${getPathBaseName(input.currentPath)}:${line}`,
      detail: compactLine(input.currentModel.getLineContent(line)),
      selection: {
        startLineNumber: item.range.startLineNumber,
        startColumn: item.range.startColumn,
        endLineNumber: item.range.endLineNumber,
        endColumn: item.range.endColumn,
      },
    })
  }

  return Array.from(deduped.values())
}

export function normalizeCodeEditorWorkspaceSymbols(input: {
  currentPath: string
  currentModel: editor.ITextModel
  result: unknown
}) {
  const currentPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()

  for (const item of normalizeWorkspaceSymbols(input.result)) {
    const path = getPathFromStringUri(item.location?.uri) ?? input.currentPath
    const range = item.location?.range
    const start = range?.start
    const end = range?.end
    if (
      typeof start?.line !== "number" ||
      typeof start.character !== "number" ||
      typeof end?.line !== "number" ||
      typeof end.character !== "number"
    ) {
      continue
    }

    const normalizedPath = normalizeCodeEditorNavigationPath(path)
    const line = start.line + 1
    const column = start.character + 1
    const selection = {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: end.line + 1,
      endColumn: end.character + 1,
    } satisfies CodeEditorNavigationSelection
    const key = `${normalizedPath}:${selection.startLineNumber}:${selection.startColumn}:${selection.endLineNumber}:${selection.endColumn}`
    if (deduped.has(key)) continue

    deduped.set(key, {
      id: key,
      path,
      label: item.name ? `${item.name} · ${getPathBaseName(path)}:${line}` : `${getPathBaseName(path)}:${line}`,
      detail: item.containerName
        ? `${item.containerName} · ${getNavigationDetail({
            currentPath,
            currentModel: input.currentModel,
            path,
            normalizedPath,
            line,
            column,
          })}`
        : getNavigationDetail({
            currentPath,
            currentModel: input.currentModel,
            path,
            normalizedPath,
            line,
            column,
          }),
      selection,
    })
  }

  return Array.from(deduped.values())
}

export function normalizeCodeEditorCallHierarchyTargets(input: {
  currentPath: string
  currentModel: editor.ITextModel
  direction: "incoming" | "outgoing"
  result: unknown
}) {
  const currentPath = normalizeCodeEditorNavigationPath(input.currentPath)
  const deduped = new Map<string, CodeEditorNavigationTargetItem>()
  const items = input.direction === "incoming" ? normalizeIncomingCalls(input.result) : normalizeOutgoingCalls(input.result)

  for (const item of items) {
    const target = input.direction === "incoming" ? (item as IncomingCallLike).from : (item as OutgoingCallLike).to
    const path = getPathFromStringUri(target?.uri) ?? input.currentPath
    const selectionRange = target?.selectionRange ?? target?.range
    const start = selectionRange?.start
    const end = selectionRange?.end
    if (
      typeof start?.line !== "number" ||
      typeof start.character !== "number" ||
      typeof end?.line !== "number" ||
      typeof end.character !== "number"
    ) {
      continue
    }

    const normalizedPath = normalizeCodeEditorNavigationPath(path)
    const selection = {
      startLineNumber: start.line + 1,
      startColumn: start.character + 1,
      endLineNumber: end.line + 1,
      endColumn: end.character + 1,
    } satisfies CodeEditorNavigationSelection
    const key = `${normalizedPath}:${selection.startLineNumber}:${selection.startColumn}:${selection.endLineNumber}:${selection.endColumn}`
    if (deduped.has(key)) continue

    const labelBase = target?.name?.trim()
    const detailBase =
      target?.detail?.trim() ||
      getNavigationDetail({
        currentPath,
        currentModel: input.currentModel,
        path,
        normalizedPath,
        line: selection.startLineNumber,
        column: selection.startColumn,
      })
    const callCount = item.fromRanges?.length ?? 0
    const detail = callCount > 0 ? `${detailBase} · ${callCount}` : detailBase

    deduped.set(key, {
      id: key,
      path,
      label: labelBase ? `${labelBase} · ${getPathBaseName(path)}:${selection.startLineNumber}` : `${getPathBaseName(path)}:${selection.startLineNumber}`,
      detail,
      selection,
    })
  }

  return Array.from(deduped.values())
}

function normalizeMonacoLocations(result: unknown): MonacoLocationLike[] {
  if (Array.isArray(result)) return result.filter(isMonacoLocationLike)
  if (isMonacoLocationLike(result)) return [result]
  return []
}

function isMonacoLocationLike(value: unknown): value is MonacoLocationLike {
  if (!value || typeof value !== "object") return false
  const item = value as MonacoLocationLike
  return Boolean(item.range || item.targetRange || item.targetSelectionRange)
}

function normalizeMonacoDocumentHighlights(result: unknown): MonacoDocumentHighlightLike[] {
  if (!Array.isArray(result)) return []
  return result.filter(isMonacoDocumentHighlightLike)
}

function isMonacoDocumentHighlightLike(value: unknown): value is MonacoDocumentHighlightLike {
  if (!value || typeof value !== "object") return false
  return Boolean((value as MonacoDocumentHighlightLike).range)
}

function normalizeWorkspaceSymbols(result: unknown): WorkspaceSymbolLike[] {
  if (!Array.isArray(result)) return []
  return result.filter(isWorkspaceSymbolLike)
}

function normalizeIncomingCalls(result: unknown): IncomingCallLike[] {
  if (!Array.isArray(result)) return []
  return result.filter(isIncomingCallLike)
}

function normalizeOutgoingCalls(result: unknown): OutgoingCallLike[] {
  if (!Array.isArray(result)) return []
  return result.filter(isOutgoingCallLike)
}

function isWorkspaceSymbolLike(value: unknown): value is WorkspaceSymbolLike {
  if (!value || typeof value !== "object") return false
  return Boolean((value as WorkspaceSymbolLike).location?.range)
}

function isIncomingCallLike(value: unknown): value is IncomingCallLike {
  if (!value || typeof value !== "object") return false
  return Boolean((value as IncomingCallLike).from?.selectionRange || (value as IncomingCallLike).from?.range)
}

function isOutgoingCallLike(value: unknown): value is OutgoingCallLike {
  if (!value || typeof value !== "object") return false
  return Boolean((value as OutgoingCallLike).to?.selectionRange || (value as OutgoingCallLike).to?.range)
}

function getPathFromUri(uri?: MonacoUriLike) {
  if (!uri) return
  if (uri.fsPath) return uri.fsPath
  if (uri.path) return uri.path
  return uri.toString()
}

function getPathFromStringUri(uri?: string) {
  if (!uri) return
  if (!uri.startsWith("file://")) return uri
  try {
    return decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, "$1")
  } catch {
    return
  }
}

function getPathBaseName(path: string) {
  const normalized = normalizeCodeEditorNavigationPath(path)
  const parts = normalized.split("/")
  return parts.at(-1) ?? normalized
}

function getNavigationDetail(input: {
  currentPath: string
  currentModel: editor.ITextModel
  path: string
  normalizedPath: string
  line: number
  column: number
}) {
  if (input.normalizedPath === input.currentPath) {
    return compactLine(input.currentModel.getLineContent(input.line))
  }
  return `${input.normalizedPath}:${input.line}:${input.column}`
}

function compactLine(input: string) {
  const line = input.replace(/\s+/g, " ").trim()
  if (line) return line
  return " "
}
