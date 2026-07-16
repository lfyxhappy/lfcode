import type { CodeEditorNavigationSelection } from "@/components/code-editor/core/navigation"
import type { CodeEditorNavigationTargetItem } from "@/components/code-editor/core/navigation-targets"

export type CodeEditorDocumentSymbolItem = {
  id: string
  label: string
  detail?: string
  depth: number
  selection: CodeEditorNavigationSelection
  range?: CodeEditorNavigationSelection
}

export type CodeEditorHoverItem = {
  id: string
  kind: "text" | "markdown" | "code"
  text: string
  language?: string
}

export type CodeEditorCommandHandle = {
  focus: () => void
  save: () => Promise<void> | void
  undo: () => Promise<void> | void
  redo: () => Promise<void> | void
  navigateBack: () => Promise<void> | void
  navigateForward: () => Promise<void> | void
  openCommandPalette: () => Promise<void> | void
  openQuickOutline: () => Promise<void> | void
  openFind: () => Promise<void> | void
  openReplace: () => Promise<void> | void
  findPrevious: () => Promise<void> | void
  findNext: () => Promise<void> | void
  openGoToLine: () => Promise<void> | void
  openQuickFix: () => Promise<void> | void
  renameSymbol: () => Promise<void> | void
  showHover: () => Promise<void> | void
  triggerSuggest: () => Promise<void> | void
  triggerParameterHints: () => Promise<void> | void
  openProblems: () => Promise<void> | void
  nextProblem: () => Promise<void> | void
  previousProblem: () => Promise<void> | void
  organizeImports: () => Promise<void> | void
  expandSelection: () => Promise<void> | void
  shrinkSelection: () => Promise<void> | void
  moveLineUp: () => Promise<void> | void
  moveLineDown: () => Promise<void> | void
  copyLineUp: () => Promise<void> | void
  copyLineDown: () => Promise<void> | void
  deleteLine: () => Promise<void> | void
  addNextMatchToSelection: () => Promise<void> | void
  duplicateSelection: () => Promise<void> | void
  insertCursorAbove: () => Promise<void> | void
  insertCursorBelow: () => Promise<void> | void
  joinLines: () => Promise<void> | void
  trimTrailingWhitespace: () => Promise<void> | void
  toggleWordWrap: () => Promise<void> | void
  foldCurrent: () => Promise<void> | void
  unfoldCurrent: () => Promise<void> | void
  foldAll: () => Promise<void> | void
  unfoldAll: () => Promise<void> | void
  peekDeclaration: () => Promise<void> | void
  peekDefinition: () => Promise<void> | void
  peekTypeDefinition: () => Promise<void> | void
  peekImplementation: () => Promise<void> | void
  peekReferences: () => Promise<void> | void
  formatDocument: () => Promise<void> | void
  formatSelection: () => Promise<void> | void
  toggleLineComment: () => Promise<void> | void
  toggleBlockComment: () => Promise<void> | void
  getHover: () => Promise<CodeEditorHoverItem[]>
  getDocumentSymbols: () => Promise<CodeEditorDocumentSymbolItem[]>
  getWorkspaceSymbols: (query: string) => Promise<CodeEditorNavigationTargetItem[]>
  getIncomingCalls: () => Promise<CodeEditorNavigationTargetItem[]>
  getOutgoingCalls: () => Promise<CodeEditorNavigationTargetItem[]>
  getDeclarations: () => Promise<CodeEditorNavigationTargetItem[]>
  getDefinitions: () => Promise<CodeEditorNavigationTargetItem[]>
  getTypeDefinitions: () => Promise<CodeEditorNavigationTargetItem[]>
  getImplementations: () => Promise<CodeEditorNavigationTargetItem[]>
  getReferences: () => Promise<CodeEditorNavigationTargetItem[]>
  getDocumentHighlights: () => Promise<CodeEditorNavigationTargetItem[]>
  openNavigationTarget: (target: CodeEditorNavigationTargetItem) => Promise<void> | void
  revealSelection: (selection: CodeEditorNavigationSelection) => void
}
