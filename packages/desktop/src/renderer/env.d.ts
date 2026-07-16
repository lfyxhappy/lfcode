import type { ElectronAPI } from "../preload/types"
import type { UiDriverEditorInput, UiDriverNodeSnapshot, UiDriverQueryInput, UiDriverReadTextInput, UiDriverTypeInput, UiDriverWaitInput } from "@lfcode-ai/app/automation/ui-driver"
import type { DetachedSidePanelContext } from "@lfcode-ai/app/pages/session/detached-side-panel"

declare global {
  type LfcodeCodeEditorAutomationSelection = {
    startLineNumber: number
    startColumn: number
    endLineNumber?: number
    endColumn?: number
  }

  type LfcodeCodeEditorAutomationDiagnostic = {
    severity: "error" | "warning"
    message: string
    line: number
    column: number
    source?: string
    code?: string
  }

  type LfcodeCodeEditorAutomationState = {
    implementation: "phase0"
    path: string
    value: string
    selection?: LfcodeCodeEditorAutomationSelection
    cursor?: { line: number; column: number }
    diagnostics: {
      errors: number
      warnings: number
      items: LfcodeCodeEditorAutomationDiagnostic[]
      open: boolean
    }
  }

  type LfcodeCodeEditorAutomationHoverItem = {
    id: string
    kind: "text" | "markdown" | "code"
    text: string
    language?: string
  }

  type LfcodeCodeEditorAutomationNavigationTarget = {
    id: string
    path: string
    label: string
    detail: string
    selection: LfcodeCodeEditorAutomationSelection
  }

  type LfcodeCodeEditorAutomationHandle = {
    getState: () => LfcodeCodeEditorAutomationState
    setValue: (value: string) => void
    setSelection: (selection: LfcodeCodeEditorAutomationSelection) => void
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
    toggleLineComment: () => Promise<void> | void
    getHover: () => Promise<LfcodeCodeEditorAutomationHoverItem[]>
    getDocumentSymbols: () => Promise<
      Array<{
        id: string
        label: string
        detail?: string
        depth: number
        selection: LfcodeCodeEditorAutomationSelection
      }>
    >
    getWorkspaceSymbols: (query: string) => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getIncomingCalls: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getOutgoingCalls: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDeclarations: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDefinitions: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getTypeDefinitions: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getImplementations: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getReferences: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    getDocumentHighlights: () => Promise<LfcodeCodeEditorAutomationNavigationTarget[]>
    openNavigationTarget: (target: LfcodeCodeEditorAutomationNavigationTarget) => Promise<void> | void
    revealSelection: (selection: LfcodeCodeEditorAutomationSelection) => void
    setDiagnosticsOpen: (open: boolean) => void
    inspectLanguage: (input: {
      kind:
        | "hover"
        | "completion"
        | "signatureHelp"
        | "declaration"
        | "definition"
        | "references"
        | "typeDefinition"
        | "implementation"
        | "documentHighlights"
        | "documentSymbols"
        | "incomingCalls"
        | "outgoingCalls"
      position?: {
        lineNumber: number
        column: number
      }
      triggerCharacter?: string
      maxItems?: number
    }) => Promise<unknown>
  }

  type LfcodeUiAutomationDriver = {
    query: (input: UiDriverQueryInput) => UiDriverNodeSnapshot
    click: (input: UiDriverQueryInput) => Promise<UiDriverNodeSnapshot>
    type: (input: UiDriverTypeInput) => Promise<UiDriverNodeSnapshot>
    readText: (input: UiDriverReadTextInput) => string
    wait: (input: UiDriverWaitInput) => Promise<UiDriverNodeSnapshot>
    editor: (input: UiDriverEditorInput) => Promise<unknown>
  }

  type LfcodeRendererAutomation = {
    getState?: () => unknown | Promise<unknown>
    call?: (action: string, input?: unknown) => unknown | Promise<unknown>
    ui?: LfcodeUiAutomationDriver
  }

  interface Window {
    api: ElectronAPI
    __LFCODE__?: {
      deepLinks?: string[]
      detachedSidePanel?: DetachedSidePanelContext
      navigate?: (route: string) => void
      automation?: LfcodeRendererAutomation
      sessionAutomation?: LfcodeRendererAutomation
    }
  }
}
