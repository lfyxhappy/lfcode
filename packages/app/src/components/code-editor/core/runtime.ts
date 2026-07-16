export type CodeEditorRuntime = Awaited<ReturnType<typeof initializeCodeEditorRuntime>>

let runtime: Promise<{
  monaco: typeof import("monaco-editor")
  createEditor: typeof import("monaco-editor").editor.create
  createModel: typeof import("monaco-editor").editor.createModel
  syncConfiguration: (input: {
    theme: "light" | "dark"
    fontSize: number
    lineHeight: number
    tabSize: number
    wordWrap: boolean
    minimap: boolean
    lineNumbers: boolean
    currentLineHighlight: boolean
    currentLineHighlightOnlyWhenFocus: boolean
    cursorStyle: "line" | "line-thin" | "block" | "block-outline" | "underline" | "underline-thin"
    cursorBlinking: "blink" | "smooth" | "phase" | "expand" | "solid"
    cursorWidth: number
    cursorSurroundingLines: number
    cursorSurroundingLinesStyle: "default" | "all"
    multiCursorModifier: "alt" | "ctrlCmd"
    hover: boolean
    selectionHighlight: boolean
    occurrencesHighlight: boolean
    linkedEditing: boolean
    inlayHints: boolean
    semanticHighlighting: boolean
    codeLens: boolean
    lightbulb: boolean
    quickSuggestions: boolean
    quickSuggestionsDelay: number
    inlineSuggestions: boolean
    wordBasedSuggestions: boolean
    parameterHints: boolean
    suggestSelection: "first" | "recentlyUsed" | "recentlyUsedByPrefix"
    snippetSuggestions: "top" | "bottom" | "inline" | "none"
    acceptSuggestionOnEnter: "smart" | "on" | "off"
    acceptSuggestionOnCommitCharacter: boolean
    tabCompletion: boolean
    showUnused: boolean
    showDeprecated: boolean
    autoClosingBrackets: boolean
    autoClosingQuotes: boolean
    dragAndDrop: boolean
    columnSelection: boolean
    copyWithSyntaxHighlighting: boolean
    matchBrackets: boolean
    colorDecorators: boolean
    renderValidationDecorations: "editable" | "on" | "off"
    unicodeHighlightAmbiguous: boolean
    unicodeHighlightInvisible: boolean
    renderWhitespace: boolean
    bracketPairGuides: boolean
    bracketPairHorizontalGuides: boolean
    highlightActiveBracketPair: boolean
    bracketPairColorization: boolean
    indentGuides: boolean
    highlightActiveIndentation: boolean
    folding: boolean
    showFoldingControls: "mouseover" | "always" | "never"
    smoothScrolling: boolean
    cursorAnimation: boolean
    mouseWheelZoom: boolean
    stickyScroll: boolean
    scrollBeyondLastLine: boolean
    rulers: number[]
    renderFinalNewline: "off" | "on" | "dimmed"
    trimAutoWhitespace: boolean
    formatOnPaste: boolean
    formatOnType: boolean
  }) => Promise<void>
  ensureLanguageSupport: (language?: string) => Promise<void>
  executeProviderCommand: (commandID: string, ...args: unknown[]) => Promise<unknown>
}> | undefined

export function initializeCodeEditorRuntime() {
  if (runtime) return runtime

  runtime = import("./runtime-core")
    .then((mod) => mod.initializeCodeEditorRuntimeCore())
    .catch((error: unknown) => {
      runtime = undefined
      throw error
    })

  return runtime
}

export async function retryCodeEditorRuntime() {
  runtime = undefined
  const { retryMonacoKernel } = await import("@lfcode-ai/ui/monaco-kernel")
  await retryMonacoKernel()
  return initializeCodeEditorRuntime()
}
