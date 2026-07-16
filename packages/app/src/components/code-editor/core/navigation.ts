import type { editor } from "monaco-editor"
import { registerMonacoCodeEditorOpenHandler } from "@lfcode-ai/ui/monaco-kernel"

export type CodeEditorNavigationSelection = {
  startLineNumber: number
  startColumn: number
  endLineNumber?: number
  endColumn?: number
}

type CodeEditorNavigationRequest = {
  selection?: CodeEditorNavigationSelection
}

type CodeEditorNavigationSnapshot = {
  path: string
  selection: CodeEditorNavigationSelection
}

const pendingRequests = new Map<string, CodeEditorNavigationRequest>()
const openHandlers = new WeakMap<editor.ICodeEditor, (input: { path: string; selection?: CodeEditorNavigationSelection }) => Promise<void> | void>()
const backHistory: CodeEditorNavigationSnapshot[] = []
const forwardHistory: CodeEditorNavigationSnapshot[] = []
let registered = false

export function normalizeCodeEditorNavigationPath(path: string) {
  return path.replaceAll("\\", "/")
}

export function queueCodeEditorNavigation(input: { path: string; selection?: CodeEditorNavigationSelection }) {
  pendingRequests.set(normalizeCodeEditorNavigationPath(input.path), {
    selection: input.selection,
  })
}

export function hasCodeEditorNavigationRequest(path: string) {
  return pendingRequests.has(normalizeCodeEditorNavigationPath(path))
}

export function consumeCodeEditorNavigationRequest(path: string) {
  const key = normalizeCodeEditorNavigationPath(path)
  const request = pendingRequests.get(key)
  if (!request) return
  pendingRequests.delete(key)
  return request
}

export function listCodeEditorNavigationRequests() {
  return Array.from(pendingRequests.keys())
}

export function pushCodeEditorNavigationHistory(input: {
  from: CodeEditorNavigationSnapshot
  to: { path: string; selection?: CodeEditorNavigationSelection }
}) {
  if (isSameCodeEditorNavigationSnapshot(input.from, input.to)) return
  if (!isSameCodeEditorNavigationSnapshot(backHistory.at(-1), input.from)) {
    backHistory.push(cloneCodeEditorNavigationSnapshot(input.from))
  }
  if (backHistory.length > 100) backHistory.shift()
  forwardHistory.length = 0
}

export function consumeCodeEditorNavigationHistory(
  direction: "back" | "forward",
  current: CodeEditorNavigationSnapshot,
) {
  const source = direction === "back" ? backHistory : forwardHistory
  const target = source.pop()
  if (!target) return

  const opposite = direction === "back" ? forwardHistory : backHistory
  if (!isSameCodeEditorNavigationSnapshot(opposite.at(-1), current)) {
    opposite.push(cloneCodeEditorNavigationSnapshot(current))
    if (opposite.length > 100) opposite.shift()
  }

  return cloneCodeEditorNavigationSnapshot(target)
}

export function resetCodeEditorNavigationHistory() {
  backHistory.length = 0
  forwardHistory.length = 0
}

export function applyCodeEditorNavigationSelection(
  target: Pick<editor.IStandaloneCodeEditor, "setPosition" | "setSelection" | "revealPositionInCenter" | "revealRangeInCenter" | "focus">,
  selection?: CodeEditorNavigationSelection,
) {
  if (!selection) return

  if (typeof selection.endLineNumber === "number" && typeof selection.endColumn === "number") {
    const range = {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    }
    target.setSelection(range)
    target.revealRangeInCenter(range)
    target.focus()
    return
  }

  const position = {
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  }
  target.setPosition(position)
  target.revealPositionInCenter(position)
  target.focus()
}

export function registerCodeEditorOpenHandler(
  target: editor.ICodeEditor,
  handler: (input: { path: string; selection?: CodeEditorNavigationSelection }) => Promise<void> | void,
) {
  ensureCodeEditorOpenHandlerRegistered()
  openHandlers.set(target, handler)
  return () => {
    openHandlers.delete(target)
  }
}

function ensureCodeEditorOpenHandlerRegistered() {
  if (registered) return

  registerMonacoCodeEditorOpenHandler(async (input, source) => {
    if (!input.resource || input.resource.scheme !== "file" || !source) return null
    if (source.getModel()?.uri.toString() === input.resource.toString()) return null

    const open = openHandlers.get(source)
    if (!open) return null

    const path = input.resource.fsPath ?? input.resource.path
    if (!path) return null

    await open({
      path,
      selection: input.options?.selection
        ? {
            startLineNumber: input.options.selection.startLineNumber,
            startColumn: input.options.selection.startColumn,
            endLineNumber: input.options.selection.endLineNumber,
            endColumn: input.options.selection.endColumn,
          }
        : undefined,
    })

    return source
  })
  registered = true
}

function cloneCodeEditorNavigationSnapshot(input: CodeEditorNavigationSnapshot) {
  return {
    path: input.path,
    selection: { ...input.selection },
  }
}

function isSameCodeEditorNavigationSnapshot(
  left: CodeEditorNavigationSnapshot | { path: string; selection?: CodeEditorNavigationSelection } | undefined,
  right: CodeEditorNavigationSnapshot | { path: string; selection?: CodeEditorNavigationSelection } | undefined,
) {
  if (!left || !right || !left.selection || !right.selection) return false
  if (normalizeCodeEditorNavigationPath(left.path) !== normalizeCodeEditorNavigationPath(right.path)) return false
  return (
    left.selection.startLineNumber === right.selection.startLineNumber &&
    left.selection.startColumn === right.selection.startColumn &&
    left.selection.endLineNumber === right.selection.endLineNumber &&
    left.selection.endColumn === right.selection.endColumn
  )
}
