export type UiDriverToken =
  | "settings.toggle"
  | "settings.dialog"
  | "settings.tab.editor"
  | "settings.tab.plugins"
  | "session.summary.toggle"
  | "composer.main.input"
  | "composer.main.submit"
  | "sidechat.active.input"
  | "sidechat.active.submit"
  | "filetab.active.panel"
  | "filetab.active.editor"
  | "filetab.active.mode.edit"
  | "filetab.active.mode.preview"
  | "filetab.active.mode.save"
  | "filetab.active.command-menu"
  | "messageblock.root"
  | "messageblock.editor"
  | "messageblock.mode.edit"
  | "messageblock.mode.preview"
  | "messageblock.mode.save"
  | "messageblock.mode.reload"
  | "messageblock.mode.open-sidebar"
  | "messageblock.mode.bind-file"

export type UiDriverNodeSnapshot = {
  token: UiDriverToken
  found: boolean
  visible: boolean
  focused?: boolean
  text?: string
  value?: string
  draftText?: string
  selectedTextCount?: number
  selectedTexts?: string[]
  dataset?: Record<string, string>
  title?: string
  ariaLabel?: string
  rect?: {
    x: number
    y: number
    width: number
    height: number
  }
  tagName?: string
}

export type UiDriverQueryInput = {
  token: UiDriverToken
  blockKey?: string
}

export type UiDriverTypeInput = UiDriverQueryInput & {
  text: string
  append?: boolean
}

export type UiDriverReadTextInput = UiDriverQueryInput

export type UiDriverWaitInput = UiDriverQueryInput & {
  timeoutMs?: number
  intervalMs?: number
  visible?: boolean
}

export type UiDriverEditorCommandAction =
  | "save"
  | "undo"
  | "redo"
  | "navigateBack"
  | "navigateForward"
  | "openCommandPalette"
  | "openQuickOutline"
  | "openFind"
  | "openReplace"
  | "findPrevious"
  | "findNext"
  | "openGoToLine"
  | "openQuickFix"
  | "renameSymbol"
  | "showHover"
  | "triggerSuggest"
  | "triggerParameterHints"
  | "openProblems"
  | "nextProblem"
  | "previousProblem"
  | "organizeImports"
  | "expandSelection"
  | "shrinkSelection"
  | "moveLineUp"
  | "moveLineDown"
  | "copyLineUp"
  | "copyLineDown"
  | "deleteLine"
  | "addNextMatchToSelection"
  | "duplicateSelection"
  | "insertCursorAbove"
  | "insertCursorBelow"
  | "joinLines"
  | "trimTrailingWhitespace"
  | "toggleWordWrap"
  | "foldCurrent"
  | "unfoldCurrent"
  | "foldAll"
  | "unfoldAll"
  | "peekDeclaration"
  | "peekDefinition"
  | "peekTypeDefinition"
  | "peekImplementation"
  | "peekReferences"
  | "formatDocument"
  | "formatSelection"
  | "toggleLineComment"
  | "toggleBlockComment"

export type UiDriverEditorQueryAction =
  | "getHover"
  | "getDocumentSymbols"
  | "getIncomingCalls"
  | "getOutgoingCalls"
  | "getDeclarations"
  | "getDefinitions"
  | "getTypeDefinitions"
  | "getImplementations"
  | "getReferences"
  | "getDocumentHighlights"

export type UiDriverEditorInput =
  | (UiDriverQueryInput & {
      action: "getState" | "focus" | UiDriverEditorCommandAction | UiDriverEditorQueryAction
    })
  | (UiDriverQueryInput & {
      action: "setSelection"
      selection: LfcodeCodeEditorAutomationSelection
    })
  | (UiDriverQueryInput & {
      action: "getWorkspaceSymbols"
      query: string
    })
  | (UiDriverQueryInput & {
      action: "openNavigationTarget"
      target: LfcodeCodeEditorAutomationNavigationTarget
    })
  | (UiDriverQueryInput & {
      action: "inspectLanguage"
      inspect: {
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
      }
    })
