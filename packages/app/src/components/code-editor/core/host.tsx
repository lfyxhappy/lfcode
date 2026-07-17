import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "@lfcode-ai/ui/theme"
import { BasicCodeEditor } from "@/components/code-editor/core/basic-editor"
import { getCodeEditorCapabilities, type CodeEditorCapabilityPreset } from "@/components/code-editor/core/capabilities"
import type {
  CodeEditorCommandHandle,
  CodeEditorDocumentSymbolItem,
} from "@/components/code-editor/core/command-handle"
import {
  collectCodeEditorDiagnostics,
  suppressBrowserOnlyModuleResolutionDiagnostics,
  type CodeEditorDiagnosticItem,
} from "@/components/code-editor/core/diagnostics"
import { flattenCodeEditorDocumentSymbols } from "@/components/code-editor/core/document-symbols"
import { emitCodeEditorMetric, startCodeEditorMetric } from "@/components/code-editor/core/metrics"
import {
  normalizeCodeEditorCallHierarchyTargets,
  normalizeCodeEditorDocumentHighlights,
  normalizeCodeEditorNavigationTargets,
  normalizeCodeEditorWorkspaceSymbols,
} from "@/components/code-editor/core/navigation-targets"
import {
  flattenServerLspDocumentSymbols,
  normalizeCodeEditorHoverItems,
  normalizeServerLspCompletionList,
  normalizeServerLspDiagnostics,
  normalizeServerLspDocumentHighlights,
  normalizeServerLspNavigationTargets,
  normalizeServerLspSignatureHelp,
  registerCodeEditorServerLspProviders,
  requestCodeEditorServerLsp,
  shouldUseCodeEditorServerLsp,
} from "@/components/code-editor/core/server-lsp"
import {
  applyCodeEditorNavigationSelection,
  consumeCodeEditorNavigationRequest,
  consumeCodeEditorNavigationHistory,
  normalizeCodeEditorNavigationPath,
  pushCodeEditorNavigationHistory,
  registerCodeEditorOpenHandler,
  type CodeEditorNavigationSelection,
} from "@/components/code-editor/core/navigation"
import { isCurrentCodeEditorSetup } from "@/components/code-editor/core/setup-guard"
import {
  acquireEditorDocument,
  getEditorDocumentFallbackStamp,
  markEditorDocumentFallbackSaved,
  recordEditorDocumentFallbackChange,
} from "@/components/code-editor/core/document-registry"
import {
  createEditorInstanceController,
  type EditorInstanceController,
} from "@/components/code-editor/core/instance-controller"
import { initializeCodeEditorRuntime, retryCodeEditorRuntime } from "@/components/code-editor/core/runtime"
import { getCodeEditorLanguage, getCodeEditorLanguageFromHint } from "@/components/code-editor/core/language"
import { loadCodeEditorViewState, saveCodeEditorViewState } from "@/components/code-editor/core/view-state"
import { registerCodeEditorSnippetProvider } from "@/components/code-editor/core/snippets"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"

type LspRuntimeStatus = {
  id: string
  name: string
  extensions: string[]
  capabilities: {
    completion: boolean
    completionTriggerCharacters: string[]
    hover: boolean
    diagnostics: boolean
    definition: boolean
    formatting: boolean
  }
  status: "available" | "connected" | "error"
  error?: string
}

const LSP_DOWNLOAD_REMINDER_PREFIX = "lfcode.editor.lsp.download-reminder.v1:"

function getRenderFinalNewlineOption(enabled: boolean): "off" | "on" {
  return enabled ? "on" : "off"
}

function containsEditorSelection(selection: CodeEditorNavigationSelection, cursor: { line: number; column: number }) {
  const endLineNumber = selection.endLineNumber ?? selection.startLineNumber
  const endColumn = selection.endColumn ?? selection.startColumn
  if (cursor.line < selection.startLineNumber || cursor.line > endLineNumber) return false
  if (cursor.line === selection.startLineNumber && cursor.column < selection.startColumn) return false
  if (cursor.line === endLineNumber && cursor.column > endColumn) return false
  return true
}

export function CodeEditorHost(props: {
  path: string
  value: string
  revision?: number
  dirty?: boolean
  readonly?: boolean
  language?: string
  preset?: CodeEditorCapabilityPreset
  onInput: (value: string) => void
  onSave?: () => Promise<unknown> | unknown
  onOpenPath?: (input: { path: string; selection?: CodeEditorNavigationSelection }) => Promise<void> | void
  onCommandHandle?: (handle: CodeEditorCommandHandle | undefined) => void
}) {
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [failureMessage, setFailureMessage] = createSignal<string>()
  const [fallbackValue, setFallbackValue] = createSignal(props.value)
  const [fallbackDirty, setFallbackDirty] = createSignal(Boolean(props.dirty))
  const [recoveringFallback, setRecoveringFallback] = createSignal(false)
  const [cursor, setCursor] = createSignal({ line: 1, column: 1 })
  const [serverLspTick, setServerLspTick] = createSignal(0)
  const [serverLspActivated, setServerLspActivated] = createSignal(false)
  const [lspCompletionTriggerCharacters, setLspCompletionTriggerCharacters] = createSignal<string[]>([])
  const [lspDownloadPrompt, setLspDownloadPrompt] = createSignal<LspRuntimeStatus>()
  const [lspDownloadError, setLspDownloadError] = createSignal<string>()
  const [lspDownloading, setLspDownloading] = createSignal(false)
  const [documentSymbols, setDocumentSymbols] = createSignal<CodeEditorDocumentSymbolItem[]>([])
  const [diagnostics, setDiagnostics] = createSignal<ReturnType<typeof collectCodeEditorDiagnostics>>({
    errors: 0,
    warnings: 0,
    items: [],
  })
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false)
  let host!: HTMLDivElement
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | undefined
  let controller: EditorInstanceController | undefined
  let documentLease: Awaited<ReturnType<typeof acquireEditorDocument>> | undefined
  let editorPath: string | undefined
  let pendingNavigationSelection: CodeEditorNavigationSelection | undefined
  let markersSubscription: import("monaco-editor").IDisposable | undefined
  let navigationCleanup: VoidFunction | undefined
  let releaseServerLspProviders: VoidFunction | undefined
  let releaseSnippetProvider: import("monaco-editor").IDisposable | undefined
  let fallbackPath: string | undefined
  let setupToken = 0
  let serverLspRequestToken = 0
  let symbolRequestToken = 0
  const resolvedLanguage = () =>
    getCodeEditorLanguageFromHint(props.language) ?? getCodeEditorLanguage(props.path) ?? "plaintext"
  const requiresManagedLsp = () => {
    const current = resolvedLanguage()
    return Boolean(current && shouldUseCodeEditorServerLsp(current) && !["typescript", "javascript"].includes(current))
  }
  const serverLspEnabled = () =>
    shouldUseCodeEditorServerLsp(resolvedLanguage()) && (!requiresManagedLsp() || serverLspActivated())
  const capabilities = () => getCodeEditorCapabilities(props.preset ?? "sidebar-full")

  const isLspDownloadSuppressed = (id: string) => {
    try {
      return localStorage.getItem(LSP_DOWNLOAD_REMINDER_PREFIX + id) === "true"
    } catch {
      return false
    }
  }

  const suppressLspDownload = (id: string) => {
    try {
      localStorage.setItem(LSP_DOWNLOAD_REMINDER_PREFIX + id, "true")
    } catch {}
  }

  const refreshLspDownloadPrompt = async () => {
    if (!requiresManagedLsp() || !server.current?.http) return
    const filename = props.path.split(/[\\/]/).at(-1)?.toLowerCase()
    const extension = props.path.match(/(\.[^.\\/]+)$/)?.[1]?.toLowerCase()
    if (!extension && !filename) return
    const response = await sdk.client.lsp.status()
    const candidate = (response.data as LspRuntimeStatus[] | undefined)?.find((item) =>
      item.extensions.some((itemExtension) => {
        const current = itemExtension.toLowerCase()
        return current === extension || current === filename
      }),
    )
    if (!candidate) return
    setLspCompletionTriggerCharacters(candidate.capabilities.completionTriggerCharacters)
    if (candidate.status === "connected") {
      setServerLspActivated(true)
      setLspDownloadPrompt(undefined)
      return
    }
    if (isLspDownloadSuppressed(candidate.id)) return
    setLspDownloadError(candidate.error)
    setLspDownloadPrompt(candidate)
  }

  const enableServerLsp = async () => {
    if (lspDownloading()) return
    setLspDownloading(true)
    setLspDownloadError(undefined)
    try {
      const response = await sdk.client.lsp.ensure({ path: props.path })
      if (!response.data?.supported) {
        const failure = response.data?.status.find((item) => item.id === lspDownloadPrompt()?.id && item.status === "error")
        setLspDownloadError(failure?.error ?? "Language server could not be started")
        return
      }
      const prompt = lspDownloadPrompt()
      setServerLspActivated(true)
      setLspDownloadPrompt(undefined)
      const active = response.data.status.find((item) => item.id === prompt?.id && item.status === "connected")
      setLspCompletionTriggerCharacters(active?.capabilities.completionTriggerCharacters ?? [])
      await refreshServerLspProviders()
      setServerLspTick((value) => value + 1)
    } catch (error) {
      setLspDownloadError(error instanceof Error ? error.message : "Language server download failed")
    } finally {
      setLspDownloading(false)
    }
  }
  const breadcrumbSymbols = createMemo(() =>
    documentSymbols()
      .filter((symbol) => containsEditorSelection(symbol.range ?? symbol.selection, cursor()))
      .sort((left, right) => left.depth - right.depth),
  )
  const editorOptions = () =>
    ({
      ...capabilities().options,
      readOnly: props.readonly ?? false,
      fontFamily: "var(--font-family-mono)",
      fontSize: settings.editor.fontSize(),
      lineHeight: settings.editor.lineHeight(),
      fontLigatures: settings.editor.fontLigatures(),
      tabSize: settings.editor.tabSize(),
      wordWrap: settings.editor.wordWrap() ? "on" : "off",
      minimap: {
        enabled: capabilities().showStatusBar && settings.editor.minimap(),
      },
      lineNumbers: capabilities().showStatusBar && settings.editor.lineNumbers() ? "on" : "off",
      glyphMargin: capabilities().showStatusBar && settings.editor.glyphMargin(),
      overviewRulerLanes: settings.editor.overviewRuler() ? 3 : 0,
      renderLineHighlight: settings.editor.currentLineHighlight() ? "line" : "none",
      renderLineHighlightOnlyWhenFocus: capabilities().showStatusBar
        ? settings.editor.currentLineHighlightOnlyWhenFocus()
        : true,
      cursorStyle: settings.editor.cursorStyle(),
      cursorBlinking: settings.editor.cursorBlinking(),
      cursorWidth: settings.editor.cursorWidth(),
      cursorSurroundingLines: settings.editor.cursorSurroundingLines(),
      cursorSurroundingLinesStyle: settings.editor.cursorSurroundingLinesStyle(),
      multiCursorModifier: settings.editor.multiCursorModifier(),
      hover: {
        enabled: settings.editor.hover(),
      },
      selectionHighlight: settings.editor.selectionHighlight(),
      occurrencesHighlight: settings.editor.occurrencesHighlight() ? "singleFile" : "off",
      linkedEditing: settings.editor.linkedEditing(),
      inlayHints: {
        enabled: settings.editor.inlayHints() ? "on" : "off",
      },
      "semanticHighlighting.enabled": settings.editor.semanticHighlighting(),
      codeLens: settings.editor.codeLens(),
      lightbulb: {
        enabled: (settings.editor.lightbulb()
          ? "onCode"
          : "off") as import("monaco-editor").editor.ShowLightbulbIconMode,
      },
      quickSuggestions: settings.editor.quickSuggestions(),
      quickSuggestionsDelay: settings.editor.quickSuggestionsDelay(),
      inlineSuggest: {
        enabled: settings.editor.inlineSuggestions(),
      },
      wordBasedSuggestions: settings.editor.wordBasedSuggestions() ? "currentDocument" : "off",
      parameterHints: {
        enabled: settings.editor.parameterHints(),
      },
      suggestSelection: settings.editor.suggestSelection(),
      snippetSuggestions: settings.editor.snippetSuggestions(),
      acceptSuggestionOnEnter: settings.editor.acceptSuggestionOnEnter(),
      acceptSuggestionOnCommitCharacter: settings.editor.acceptSuggestionOnCommitCharacter(),
      tabCompletion: settings.editor.tabCompletion() ? "on" : "off",
      showUnused: settings.editor.showUnused(),
      showDeprecated: settings.editor.showDeprecated(),
      autoClosingBrackets: settings.editor.autoClosingBrackets() ? "languageDefined" : "never",
      autoClosingQuotes: settings.editor.autoClosingQuotes() ? "languageDefined" : "never",
      dragAndDrop: settings.editor.dragAndDrop(),
      columnSelection: settings.editor.columnSelection(),
      copyWithSyntaxHighlighting: settings.editor.copyWithSyntaxHighlighting(),
      matchBrackets: settings.editor.matchBrackets() ? "always" : "never",
      colorDecorators: settings.editor.colorDecorators(),
      renderValidationDecorations: settings.editor.renderValidationDecorations(),
      unicodeHighlight: {
        ambiguousCharacters: settings.editor.unicodeHighlightAmbiguous(),
        invisibleCharacters: settings.editor.unicodeHighlightInvisible(),
      },
      renderControlCharacters: settings.editor.renderControlCharacters(),
      renderWhitespace: settings.editor.renderWhitespace() ? "boundary" : "none",
      guides: {
        indentation: settings.editor.indentGuides(),
        highlightActiveIndentation: settings.editor.highlightActiveIndentation(),
        bracketPairs: settings.editor.bracketPairGuides(),
        bracketPairsHorizontal: settings.editor.bracketPairHorizontalGuides(),
        highlightActiveBracketPair: settings.editor.highlightActiveBracketPair(),
      },
      bracketPairColorization: {
        enabled: settings.editor.bracketPairColorization(),
        independentColorPoolPerBracketType: true,
      },
      folding: capabilities().options.folding !== false && settings.editor.folding(),
      showFoldingControls: settings.editor.showFoldingControls(),
      smoothScrolling: settings.editor.smoothScrolling(),
      cursorSmoothCaretAnimation: settings.editor.cursorAnimation() ? "on" : "off",
      mouseWheelZoom: settings.editor.mouseWheelZoom(),
      stickyScroll: {
        enabled: settings.editor.stickyScroll(),
      },
      scrollBeyondLastLine: settings.editor.scrollBeyondLastLine(),
      rulers: settings.editor.rulers(),
      renderFinalNewline: getRenderFinalNewlineOption(settings.editor.renderFinalNewline()),
      trimAutoWhitespace: settings.editor.trimAutoWhitespace(),
      formatOnPaste: settings.editor.formatOnPaste(),
      formatOnType: settings.editor.formatOnType(),
    }) satisfies import("monaco-editor").editor.IStandaloneEditorConstructionOptions
  const runtimeConfiguration = () => ({
    theme: theme.mode() === "dark" ? ("dark" as const) : ("light" as const),
    fontSize: settings.editor.fontSize(),
    lineHeight: settings.editor.lineHeight(),
    fontLigatures: settings.editor.fontLigatures(),
    tabSize: settings.editor.tabSize(),
    wordWrap: settings.editor.wordWrap(),
    minimap: capabilities().showStatusBar && settings.editor.minimap(),
    lineNumbers: capabilities().showStatusBar && settings.editor.lineNumbers(),
    glyphMargin: capabilities().showStatusBar && settings.editor.glyphMargin(),
    overviewRuler: settings.editor.overviewRuler(),
    currentLineHighlight: settings.editor.currentLineHighlight(),
    currentLineHighlightOnlyWhenFocus: capabilities().showStatusBar
      ? settings.editor.currentLineHighlightOnlyWhenFocus()
      : true,
    cursorStyle: settings.editor.cursorStyle(),
    cursorBlinking: settings.editor.cursorBlinking(),
    cursorWidth: settings.editor.cursorWidth(),
    cursorSurroundingLines: settings.editor.cursorSurroundingLines(),
    cursorSurroundingLinesStyle: settings.editor.cursorSurroundingLinesStyle(),
    multiCursorModifier: settings.editor.multiCursorModifier(),
    hover: settings.editor.hover(),
    selectionHighlight: settings.editor.selectionHighlight(),
    occurrencesHighlight: settings.editor.occurrencesHighlight(),
    linkedEditing: settings.editor.linkedEditing(),
    inlayHints: settings.editor.inlayHints(),
    semanticHighlighting: settings.editor.semanticHighlighting(),
    codeLens: settings.editor.codeLens(),
    lightbulb: settings.editor.lightbulb(),
    quickSuggestions: settings.editor.quickSuggestions(),
    quickSuggestionsDelay: settings.editor.quickSuggestionsDelay(),
    inlineSuggestions: settings.editor.inlineSuggestions(),
    wordBasedSuggestions: settings.editor.wordBasedSuggestions(),
    parameterHints: settings.editor.parameterHints(),
    suggestSelection: settings.editor.suggestSelection(),
    snippetSuggestions: settings.editor.snippetSuggestions(),
    acceptSuggestionOnEnter: settings.editor.acceptSuggestionOnEnter(),
    acceptSuggestionOnCommitCharacter: settings.editor.acceptSuggestionOnCommitCharacter(),
    tabCompletion: settings.editor.tabCompletion(),
    showUnused: settings.editor.showUnused(),
    showDeprecated: settings.editor.showDeprecated(),
    autoClosingBrackets: settings.editor.autoClosingBrackets(),
    autoClosingQuotes: settings.editor.autoClosingQuotes(),
    dragAndDrop: settings.editor.dragAndDrop(),
    columnSelection: settings.editor.columnSelection(),
    copyWithSyntaxHighlighting: settings.editor.copyWithSyntaxHighlighting(),
    matchBrackets: settings.editor.matchBrackets(),
    colorDecorators: settings.editor.colorDecorators(),
    renderValidationDecorations: settings.editor.renderValidationDecorations(),
    unicodeHighlightAmbiguous: settings.editor.unicodeHighlightAmbiguous(),
    unicodeHighlightInvisible: settings.editor.unicodeHighlightInvisible(),
    renderControlCharacters: settings.editor.renderControlCharacters(),
    renderWhitespace: settings.editor.renderWhitespace(),
    bracketPairGuides: settings.editor.bracketPairGuides(),
    bracketPairHorizontalGuides: settings.editor.bracketPairHorizontalGuides(),
    highlightActiveBracketPair: settings.editor.highlightActiveBracketPair(),
    bracketPairColorization: settings.editor.bracketPairColorization(),
    indentGuides: settings.editor.indentGuides(),
    highlightActiveIndentation: settings.editor.highlightActiveIndentation(),
    folding: settings.editor.folding(),
    showFoldingControls: settings.editor.showFoldingControls(),
    smoothScrolling: settings.editor.smoothScrolling(),
    cursorAnimation: settings.editor.cursorAnimation(),
    mouseWheelZoom: settings.editor.mouseWheelZoom(),
    stickyScroll: settings.editor.stickyScroll(),
    scrollBeyondLastLine: settings.editor.scrollBeyondLastLine(),
    rulers: settings.editor.rulers(),
    renderFinalNewline: getRenderFinalNewlineOption(settings.editor.renderFinalNewline()),
    trimAutoWhitespace: settings.editor.trimAutoWhitespace(),
    formatOnPaste: settings.editor.formatOnPaste(),
    formatOnType: settings.editor.formatOnType(),
  })

  const failMetric = () => {
    emitCodeEditorMetric({
      stage: "editor:failed",
      path: props.path,
      language: resolvedLanguage(),
      at: performance.now(),
    })
  }

  const getSelectionState = (): LfcodeCodeEditorAutomationSelection | undefined => {
    const selection = editor?.getSelection()
    if (!selection) return
    return {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    }
  }

  const getAutomationState = (): LfcodeCodeEditorAutomationState => ({
    implementation: "phase0",
    path: props.path,
    language: editor?.getModel()?.getLanguageId() ?? resolvedLanguage() ?? "plaintext",
    requestedLanguage: resolvedLanguage(),
    modelURI: editor?.getModel()?.uri.toString(),
    compatibilityRuntimeInitialized: false,
    value: editor?.getValue() ?? props.value,
    selection: getSelectionState(),
    cursor: ready() ? cursor() : undefined,
    diagnostics: {
      errors: diagnostics().errors,
      warnings: diagnostics().warnings,
      items: diagnostics().items,
      open: diagnosticsOpen(),
    },
    ...(failureMessage() ? { failureMessage: failureMessage() } : {}),
  })

  const revealSelection = (selection: CodeEditorNavigationSelection) => {
    if (!editor) return
    applyCodeEditorNavigationSelection(editor, selection)
  }

  const getCurrentNavigationSelection = (): CodeEditorNavigationSelection | undefined => {
    const selection = editor?.getSelection()
    if (selection) {
      return {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      }
    }

    const position = editor?.getPosition()
    if (!position) return
    return {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
    }
  }

  const getCurrentNavigationSnapshot = () => {
    const selection = getCurrentNavigationSelection()
    if (!selection) return
    return {
      path: props.path,
      selection,
    }
  }

  const runEditorAction = async (actionID: string) => {
    if (!editor) return
    editor.focus()
    const action = editor.getAction(actionID)
    if (!action) return
    await action.run()
  }

  const saveEditor = async () => {
    if (settings.editor.formatOnSave() && editor) {
      await runEditorAction("editor.action.formatDocument")
    }
    const lease = documentLease
    const stamp = lease?.stamp()
    const fallbackStamp =
      failed() && fallbackPath === props.path
        ? getEditorDocumentFallbackStamp({ path: fallbackPath, value: fallbackValue() })
        : undefined
    const result = await props.onSave?.()
    if (result === false) return
    if (stamp) lease?.markSaved(stamp)
    if (!fallbackStamp) return
    if (fallbackPath !== fallbackStamp.path || fallbackValue() !== fallbackStamp.value) return
    if (!markEditorDocumentFallbackSaved(fallbackStamp)) return
    setFallbackDirty(false)
  }

  const requestServerLsp = async (
    query:
      | { kind: "diagnostics" | "documentSymbol" }
      | {
          kind:
            | "hover"
            | "completion"
            | "signatureHelp"
            | "declaration"
            | "definition"
            | "typeDefinition"
            | "references"
            | "implementation"
            | "documentHighlights"
            | "incomingCalls"
            | "outgoingCalls"
          position: { lineNumber: number; column: number }
          triggerCharacter?: string
          maxItems?: number
        },
  ) => {
    if (!serverLspEnabled()) return { supported: false as const }
    return requestCodeEditorServerLsp({
      server: server.current?.http,
      directory: sdk.directory,
      path: props.path,
      text: editor?.getValue() ?? props.value,
      query,
    })
  }

  const loadDocumentSymbols = async () => {
    const result = await executeEditorProviderCommand("_executeDocumentSymbolProvider")
    const items = flattenCodeEditorDocumentSymbols(result)
    if (items.length > 0 || !serverLspEnabled()) return items
    const response = await requestServerLsp({ kind: "documentSymbol" })
    if (!response.supported) return items
    return flattenServerLspDocumentSymbols(response.result)
  }

  const refreshDocumentSymbols = async () => {
    if (!ready() || failed() || !editor) {
      setDocumentSymbols([])
      return
    }
    const requestToken = ++symbolRequestToken
    const items = await loadDocumentSymbols().catch(() => [])
    if (requestToken !== symbolRequestToken) return
    setDocumentSymbols(items)
  }

  const loadWorkspaceSymbols = async (query: string) => {
    const model = editor?.getModel()
    if (!model) return []
    const trimmed = query.trim()
    if (!trimmed) return []
    const response = await sdk.client.find.symbols({
      query: trimmed,
    })
    return normalizeCodeEditorWorkspaceSymbols({
      currentPath: props.path,
      currentModel: model,
      result: response.data ?? [],
    })
  }

  const loadHover = async () => {
    if (!editor) return []
    const model = editor.getModel()
    if (!model) return []
    const position = editor.getPosition()
    if (!position) return []
    const items = normalizeCodeEditorHoverItems(
      await executeEditorProviderCommand("_executeHoverProvider", model.uri, position),
    )
    if (items.length > 0 || !serverLspEnabled()) return items
    const response = await requestServerLsp({ kind: "hover", position })
    if (!response.supported) return items
    return normalizeCodeEditorHoverItems(response.result)
  }

  const executeEditorProviderCommand = async (commandID: string, ...args: unknown[]) => {
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const runtime = await initializeCodeEditorRuntime()
    await runtime.ensureLanguageSupport(model.getLanguageId())
    return runtime.executeProviderCommand(commandID, ...args)
  }

  const loadNavigationTargets = async (
    commandID:
      | "_executeDeclarationProvider"
      | "_executeDefinitionProvider"
      | "_executeTypeDefinitionProvider"
      | "_executeImplementationProvider"
      | "_executeReferenceProvider",
  ) => {
    if (!editor) return []
    const model = editor.getModel()
    if (!model) return []
    const position = editor.getPosition()
    if (!position) return []
    const items = normalizeCodeEditorNavigationTargets({
      currentPath: props.path,
      currentModel: model,
      result: await executeEditorProviderCommand(commandID, model.uri, position),
    })
    if (items.length > 0 || !serverLspEnabled()) return items
    const queryKind = (() => {
      if (commandID === "_executeDeclarationProvider") return "declaration" as const
      if (commandID === "_executeDefinitionProvider") return "definition" as const
      if (commandID === "_executeTypeDefinitionProvider") return "typeDefinition" as const
      if (commandID === "_executeReferenceProvider") return "references" as const
      return "implementation" as const
    })()
    const response = await requestServerLsp({ kind: queryKind, position })
    if (!response.supported) return items
    return normalizeServerLspNavigationTargets({
      currentPath: props.path,
      result: response.result,
    })
  }

  const loadDocumentHighlights = async () => {
    if (!editor) return []
    const model = editor.getModel()
    if (!model) return []
    const position = editor.getPosition()
    if (!position) return []
    const items = normalizeCodeEditorDocumentHighlights({
      currentPath: props.path,
      currentModel: model,
      result: await executeEditorProviderCommand("_executeDocumentHighlights", model.uri, position),
    })
    if (items.length > 0 || !serverLspEnabled()) return items
    const response = await requestServerLsp({ kind: "documentHighlights", position })
    if (!response.supported) return items
    return normalizeServerLspDocumentHighlights({
      currentPath: props.path,
      currentModel: model,
      result: response.result,
    })
  }

  const loadCallHierarchyTargets = async (direction: "incoming" | "outgoing") => {
    if (!editor) return []
    const model = editor.getModel()
    if (!model) return []
    const position = editor.getPosition()
    if (!position) return []
    if (!serverLspEnabled()) return []
    const response = await requestServerLsp({
      kind: direction === "incoming" ? "incomingCalls" : "outgoingCalls",
      position,
    })
    if (!response.supported) return []
    return normalizeCodeEditorCallHierarchyTargets({
      currentPath: props.path,
      currentModel: model,
      direction,
      result: response.result,
    })
  }

  const openNavigationTarget = async (
    input: { path: string; selection: CodeEditorNavigationSelection },
    options?: { recordHistory?: boolean },
  ) => {
    if (options?.recordHistory !== false) {
      const current = getCurrentNavigationSnapshot()
      if (current) pushCodeEditorNavigationHistory({ from: current, to: input })
    }
    if (normalizeCodeEditorNavigationPath(input.path) === normalizeCodeEditorNavigationPath(props.path)) {
      revealSelection(input.selection)
      return
    }
    await props.onOpenPath?.(input)
  }

  const navigateHistory = async (direction: "back" | "forward") => {
    const current = getCurrentNavigationSnapshot()
    if (!current) return
    const target = consumeCodeEditorNavigationHistory(direction, current)
    if (!target) return
    await openNavigationTarget(target, { recordHistory: false })
  }

  const sharedEditorHandle = (): CodeEditorCommandHandle => ({
    focus: () => {
      editor?.focus()
    },
    save: saveEditor,
    undo: () => runEditorAction("undo"),
    redo: () => runEditorAction("redo"),
    navigateBack: () => navigateHistory("back"),
    navigateForward: () => navigateHistory("forward"),
    openCommandPalette: () => runEditorAction("editor.action.quickCommand"),
    openQuickOutline: () => runEditorAction("editor.action.quickOutline"),
    openFind: () => runEditorAction("actions.find"),
    openReplace: () => runEditorAction("editor.action.startFindReplaceAction"),
    findPrevious: () => runEditorAction("editor.action.previousMatchFindAction"),
    findNext: () => runEditorAction("editor.action.nextMatchFindAction"),
    openGoToLine: () => runEditorAction("editor.action.gotoLine"),
    openQuickFix: () => runEditorAction("editor.action.quickFix"),
    renameSymbol: () => runEditorAction("editor.action.rename"),
    showHover: () => runEditorAction("editor.action.showHover"),
    triggerSuggest: () => runEditorAction("editor.action.triggerSuggest"),
    triggerParameterHints: () => runEditorAction("editor.action.triggerParameterHints"),
    openProblems: () => {
      setDiagnosticsOpen(true)
    },
    nextProblem: () => runEditorAction("editor.action.marker.next"),
    previousProblem: () => runEditorAction("editor.action.marker.prev"),
    organizeImports: () => runEditorAction("editor.action.organizeImports"),
    expandSelection: () => runEditorAction("editor.action.smartSelect.expand"),
    shrinkSelection: () => runEditorAction("editor.action.smartSelect.shrink"),
    moveLineUp: () => runEditorAction("editor.action.moveLinesUpAction"),
    moveLineDown: () => runEditorAction("editor.action.moveLinesDownAction"),
    copyLineUp: () => runEditorAction("editor.action.copyLinesUpAction"),
    copyLineDown: () => runEditorAction("editor.action.copyLinesDownAction"),
    deleteLine: () => runEditorAction("editor.action.deleteLines"),
    addNextMatchToSelection: () => runEditorAction("editor.action.addSelectionToNextFindMatch"),
    duplicateSelection: () => runEditorAction("editor.action.duplicateSelection"),
    insertCursorAbove: () => runEditorAction("editor.action.insertCursorAbove"),
    insertCursorBelow: () => runEditorAction("editor.action.insertCursorBelow"),
    joinLines: () => runEditorAction("editor.action.joinLines"),
    trimTrailingWhitespace: () => runEditorAction("editor.action.trimTrailingWhitespace"),
    toggleWordWrap: () => runEditorAction("editor.action.toggleWordWrap"),
    foldCurrent: () => runEditorAction("editor.fold"),
    unfoldCurrent: () => runEditorAction("editor.unfold"),
    foldAll: () => runEditorAction("editor.foldAll"),
    unfoldAll: () => runEditorAction("editor.unfoldAll"),
    peekDeclaration: () => runEditorAction("editor.action.peekDeclaration"),
    peekDefinition: () => runEditorAction("editor.action.peekDefinition"),
    peekTypeDefinition: () => runEditorAction("editor.action.peekTypeDefinition"),
    peekImplementation: () => runEditorAction("editor.action.peekImplementation"),
    peekReferences: () => runEditorAction("editor.action.referenceSearch.trigger"),
    formatDocument: () => runEditorAction("editor.action.formatDocument"),
    formatSelection: () => runEditorAction("editor.action.formatSelection"),
    toggleLineComment: () => runEditorAction("editor.action.commentLine"),
    toggleBlockComment: () => runEditorAction("editor.action.blockComment"),
    getHover: loadHover,
    getDocumentSymbols: loadDocumentSymbols,
    getWorkspaceSymbols: loadWorkspaceSymbols,
    getIncomingCalls: () => loadCallHierarchyTargets("incoming"),
    getOutgoingCalls: () => loadCallHierarchyTargets("outgoing"),
    getDeclarations: () => loadNavigationTargets("_executeDeclarationProvider"),
    getDefinitions: () => loadNavigationTargets("_executeDefinitionProvider"),
    getTypeDefinitions: () => loadNavigationTargets("_executeTypeDefinitionProvider"),
    getImplementations: () => loadNavigationTargets("_executeImplementationProvider"),
    getReferences: () => loadNavigationTargets("_executeReferenceProvider"),
    getDocumentHighlights: loadDocumentHighlights,
    openNavigationTarget: (target) => openNavigationTarget(target),
    revealSelection,
  })

  const commandHandle = (): CodeEditorCommandHandle => sharedEditorHandle()

  const automationHandle = (): LfcodeCodeEditorAutomationHandle => ({
    getState: getAutomationState,
    setValue: (value: string) => {
      if (!editor || !controller) return
      controller.applyExternalValue(value)
      const change = documentLease?.recordEditorChange()
      props.onInput(change?.value ?? value)
    },
    setSelection: (selection: LfcodeCodeEditorAutomationSelection) => {
      if (!editor) return
      editor.setSelection({
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber ?? selection.startLineNumber,
        endColumn: selection.endColumn ?? selection.startColumn,
      })
      editor.revealPositionInCenter({
        lineNumber: selection.startLineNumber,
        column: selection.startColumn,
      })
      editor.focus()
    },
    ...sharedEditorHandle(),
    setDiagnosticsOpen: (open: boolean) => {
      setDiagnosticsOpen(open)
    },
    inspectLanguage: async (input) => {
      if (!editor) return null
      const model = editor.getModel()
      if (!model) return null
      const runtime = await initializeCodeEditorRuntime()
      await runtime.ensureLanguageSupport(model.getLanguageId())
      const position = input.position ?? {
        lineNumber: editor.getPosition()?.lineNumber ?? 1,
        column: editor.getPosition()?.column ?? 1,
      }
      if (input.kind === "hover") {
        const result = await runtime.executeProviderCommand("_executeHoverProvider", model.uri, position)
        if (result || !serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "hover", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "completion") {
        const result = await runtime.executeProviderCommand(
          "_executeCompletionItemProvider",
          model.uri,
          position,
          input.triggerCharacter,
          input.maxItems,
        )
        const items = normalizeServerLspCompletionList({
          result,
          monaco: runtime.monaco,
          model,
          position,
        })
        if (items.suggestions.length > 0 || !serverLspEnabled()) return result
        const response = await requestServerLsp({
          kind: "completion",
          position,
          triggerCharacter: input.triggerCharacter,
          maxItems: input.maxItems,
        })
        return response.supported ? response.result : result
      }
      if (input.kind === "signatureHelp") {
        const result = await runtime.executeProviderCommand("_executeSignatureHelpProvider", model.uri, position)
        if (normalizeServerLspSignatureHelp({ result, monaco: runtime.monaco }) || !serverLspEnabled()) return result
        const response = await requestServerLsp({
          kind: "signatureHelp",
          position,
          triggerCharacter: input.triggerCharacter,
        })
        return response.supported ? response.result : result
      }
      if (input.kind === "definition") {
        const result = await runtime.executeProviderCommand("_executeDefinitionProvider", model.uri, position)
        if (normalizeCodeEditorNavigationTargets({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "definition", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "declaration") {
        const result = await runtime.executeProviderCommand("_executeDeclarationProvider", model.uri, position)
        if (normalizeCodeEditorNavigationTargets({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "declaration", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "references") {
        const result = await runtime.executeProviderCommand("_executeReferenceProvider", model.uri, position)
        if (normalizeCodeEditorNavigationTargets({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "references", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "typeDefinition") {
        const result = await runtime.executeProviderCommand("_executeTypeDefinitionProvider", model.uri, position)
        if (normalizeCodeEditorNavigationTargets({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "typeDefinition", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "implementation") {
        const result = await runtime.executeProviderCommand("_executeImplementationProvider", model.uri, position)
        if (normalizeCodeEditorNavigationTargets({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "implementation", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "documentHighlights") {
        const result = await runtime.executeProviderCommand("_executeDocumentHighlights", model.uri, position)
        if (normalizeCodeEditorDocumentHighlights({ currentPath: props.path, currentModel: model, result }).length > 0)
          return result
        if (!serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "documentHighlights", position })
        return response.supported ? response.result : result
      }
      if (input.kind === "incomingCalls" || input.kind === "outgoingCalls") {
        if (!serverLspEnabled()) return []
        const response = await requestServerLsp({ kind: input.kind, position })
        return response.supported ? response.result : []
      }
      if (input.kind === "documentSymbols") {
        const result = await runtime.executeProviderCommand("_executeDocumentSymbolProvider", model.uri)
        if (flattenCodeEditorDocumentSymbols(result).length > 0 || !serverLspEnabled()) return result
        const response = await requestServerLsp({ kind: "documentSymbol" })
        return response.supported ? response.result : result
      }
      const result = await runtime.executeProviderCommand("_executeDocumentSymbolProvider", model.uri)
      if (flattenCodeEditorDocumentSymbols(result).length > 0 || !serverLspEnabled()) return result
      const response = await requestServerLsp({ kind: "documentSymbol" })
      return response.supported ? response.result : result
    },
  })

  const refreshServerLspProviders = async (input?: {
    runtime?: Awaited<ReturnType<typeof initializeCodeEditorRuntime>>
    path?: string
    language?: string
    value?: string
  }) => {
    const path = input?.path ?? editorPath
    if (!path || !editor) return
    const language = input?.language ?? resolvedLanguage()
    const runtime = input?.runtime ?? (await initializeCodeEditorRuntime())
    if (!editor || editorPath !== path) return
    releaseServerLspProviders?.()
    releaseServerLspProviders = registerCodeEditorServerLspProviders({
      monaco: runtime.monaco,
      server: server.current?.http,
      directory: sdk.directory,
      path,
      language,
      getText: () => editor?.getValue() ?? input?.value ?? props.value,
      enabled: serverLspEnabled,
      completionTriggerCharacters: lspCompletionTriggerCharacters(),
    })
  }

  const disposeDocument = () => {
    serverLspRequestToken += 1
    if (editor && editorPath) saveCodeEditorViewState(editorPath, editor.saveViewState())
    markersSubscription?.dispose()
    markersSubscription = undefined
    controller?.setModel(null)
    documentLease?.release()
    documentLease = undefined
    navigationCleanup?.()
    navigationCleanup = undefined
    releaseServerLspProviders?.()
    releaseServerLspProviders = undefined
    releaseSnippetProvider?.dispose()
    releaseSnippetProvider = undefined
    editorPath = undefined
    pendingNavigationSelection = undefined
    setDiagnostics({ errors: 0, warnings: 0, items: [] })
    setDiagnosticsOpen(false)
  }

  const disposeEditor = () => {
    disposeDocument()
    controller?.dispose()
    controller = undefined
    editor = undefined
  }

  const createSetupInput = () => {
    const recoverFallback = recoveringFallback() && fallbackPath === props.path
    return {
      path: props.path,
      value: recoverFallback ? fallbackValue() : props.value,
      language: resolvedLanguage(),
      revision: props.revision ?? 0,
      dirty: recoverFallback ? fallbackDirty() : Boolean(props.dirty),
      force: recoverFallback,
      readonly: props.readonly ?? false,
    }
  }

  const handleSetupFailure = (error: unknown, input: ReturnType<typeof createSetupInput>) => {
    if (input.path !== props.path) return
    disposeEditor()
    fallbackPath = input.path
    setFallbackValue(input.value)
    setFallbackDirty(input.dirty)
    setRecoveringFallback(true)
    setReady(false)
    setFailed(true)
    setFailureMessage(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    failMetric()
  }

  const setupEditor = async () => {
    if (!host) return
    const input = createSetupInput()
    const token = ++setupToken
    const completeEditor = startCodeEditorMetric("editor:start", {
      path: input.path,
      language: input.language,
    })
    let modelLease: Awaited<ReturnType<typeof acquireEditorDocument>> | undefined
    setFailed(false)
    setFailureMessage(undefined)
    setReady(false)
    try {
      const runtime = await initializeCodeEditorRuntime()
      await runtime.syncConfiguration(runtimeConfiguration())
      await runtime.ensureLanguageSupport(input.language)
      if (!isCurrentCodeEditorSetup({ token, currentToken: setupToken, path: input.path, currentPath: props.path }))
        return
      modelLease = await acquireEditorDocument(input)
      if (!isCurrentCodeEditorSetup({ token, currentToken: setupToken, path: input.path, currentPath: props.path })) {
        modelLease.release()
        return
      }
      if (!controller) {
        controller = createEditorInstanceController({
          runtime,
          host,
          options: editorOptions(),
          onInput: () => {
            const lease = documentLease
            if (!lease || lease.document().path !== props.path) return
            const change = lease.recordEditorChange()
            setServerLspTick((value) => value + 1)
            props.onInput(change.value)
          },
          onCursor: setCursor,
          onSave: () => void saveEditor(),
        })
        editor = controller.editor
      }
      disposeDocument()
      documentLease = modelLease
      modelLease = undefined
      editorPath = input.path
      controller.setModel(documentLease.model)
      controller.updateOptions(editorOptions())
      const activeEditor = controller.editor
      const updateDiagnostics = () => {
        const model = editor?.getModel()
        if (!model) {
          setDiagnostics({ errors: 0, warnings: 0, items: [] })
          return
        }
        suppressBrowserOnlyModuleResolutionDiagnostics({ monaco: runtime.monaco, model })
        const next = collectCodeEditorDiagnostics({
          monaco: runtime.monaco,
          model,
        })
        setDiagnostics(next)
        if (next.items.length === 0) setDiagnosticsOpen(false)
      }
      updateDiagnostics()
      markersSubscription = runtime.monaco.editor.onDidChangeMarkers((resources) => {
        const uri = editor?.getModel()?.uri
        if (!uri) return
        if (!resources.some((resource) => resource.toString() === uri.toString())) return
        updateDiagnostics()
      })
      if (props.onOpenPath) {
        navigationCleanup = registerCodeEditorOpenHandler(activeEditor, props.onOpenPath)
      }
      await refreshServerLspProviders({ runtime, path: input.path, language: input.language, value: input.value })
      releaseSnippetProvider = registerCodeEditorSnippetProvider({
        monaco: runtime.monaco,
        directory: sdk.directory,
        path: input.path,
        language: input.language,
        loadFiles: async (directory) => platform.readEditorSnippets?.(directory) ?? [],
      })
      const viewState = loadCodeEditorViewState(input.path)
      if (viewState) activeEditor.restoreViewState(viewState)
      pendingNavigationSelection = consumeCodeEditorNavigationRequest(input.path)?.selection
      applyCodeEditorNavigationSelection(activeEditor, pendingNavigationSelection)
      const position = activeEditor.getPosition()
      if (position) {
        setCursor({
          line: position.lineNumber,
          column: position.column,
        })
      }
      if (fallbackPath === input.path) setRecoveringFallback(false)
      setServerLspTick((value) => value + 1)
      setReady(true)
      void refreshDocumentSymbols()
      completeEditor("editor:ready")
    } catch (error) {
      const value =
        modelLease?.model.getValue() ??
        (documentLease?.document().path === input.path ? documentLease.document().value : input.value)
      modelLease?.release()
      if (!isCurrentCodeEditorSetup({ token, currentToken: setupToken, path: input.path, currentPath: props.path }))
        return
      handleSetupFailure(error, { ...input, value })
    }
  }

  const retryEditor = async () => {
    const input = createSetupInput()
    const token = ++setupToken
    setReady(false)
    setFailed(false)
    setFailureMessage(undefined)
    try {
      await retryCodeEditorRuntime()
      if (!isCurrentCodeEditorSetup({ token, currentToken: setupToken, path: input.path, currentPath: props.path }))
        return
      await setupEditor()
    } catch (error) {
      if (!isCurrentCodeEditorSetup({ token, currentToken: setupToken, path: input.path, currentPath: props.path }))
        return
      handleSetupFailure(error, input)
    }
  }

  onMount(() => {
    void setupEditor()
  })

  createEffect(
    on(
      () => props.path,
      () => {
        if (!host) return
        void setupEditor()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      [ready, failed, resolvedLanguage, () => props.path],
      ([isReady, isFailed]) => {
        if (!isReady || isFailed) return
        setServerLspActivated(!requiresManagedLsp())
        setLspDownloadPrompt(undefined)
        setLspDownloadError(undefined)
        void refreshLspDownloadPrompt().catch(() => {})
      },
    ),
  )

  createEffect(() => {
    runtimeConfiguration()
    if (!ready()) return
    void initializeCodeEditorRuntime().then((runtime) => {
      void runtime.syncConfiguration(runtimeConfiguration())
      controller?.updateOptions(editorOptions())
    })
  })

  createEffect(
    on(
      [failed, () => props.path, () => props.value, () => props.dirty],
      ([isFailed, path, value, dirty]) => {
        if (!isFailed) return
        if (fallbackPath !== path) {
          fallbackPath = path
          setFallbackValue(value)
          setFallbackDirty(Boolean(dirty))
          setRecoveringFallback(true)
          return
        }
        if (fallbackDirty() && dirty !== false) return
        setFallbackValue(value)
        setFallbackDirty(Boolean(dirty))
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const next = props.value
    const revision = props.revision ?? 0
    if (!editor || !controller || !documentLease) return
    if (documentLease.document().path !== props.path) return
    const change = documentLease.applyExternal(next, revision, props.dirty === false)
    if (!change) return
    if (editor.getValue() === change.value) return
    const viewState = editor.saveViewState()
    const selection = editor.getSelection()
    const model = editor.getModel()
    controller.applyExternalValue(change.value)
    if (pendingNavigationSelection) {
      applyCodeEditorNavigationSelection(editor, pendingNavigationSelection)
      pendingNavigationSelection = undefined
      return
    }
    if (viewState) editor.restoreViewState(viewState)
    if (selection && model) editor.setSelection(model.validateRange(selection))
  })

  createEffect(
    on(
      [ready, failed, resolvedLanguage, () => props.path, serverLspTick],
      ([isReady, isFailed, currentLanguage, currentPath]) => {
        const model = editor?.getModel()
        if (!model) return
        if (!isReady || isFailed || !shouldUseCodeEditorServerLsp(currentLanguage)) {
          serverLspRequestToken += 1
          model &&
            initializeCodeEditorRuntime().then((runtime) =>
              runtime.monaco.editor.setModelMarkers(model, "lfcode-lsp", []),
            )
          return
        }

        const requestToken = ++serverLspRequestToken
        const timer = setTimeout(() => {
          void requestServerLsp({ kind: "diagnostics" })
            .then(async (response) => {
              const runtime = await initializeCodeEditorRuntime()
              const activeModel = editor?.getModel()
              if (!activeModel || requestToken !== serverLspRequestToken) return
              if (currentPath !== props.path) return
              const markers = response.supported ? normalizeServerLspDiagnostics(response.result, runtime.monaco) : []
              runtime.monaco.editor.setModelMarkers(activeModel, "lfcode-lsp", markers)
            })
            .catch(async () => {
              const runtime = await initializeCodeEditorRuntime()
              const activeModel = editor?.getModel()
              if (!activeModel || requestToken !== serverLspRequestToken) return
              runtime.monaco.editor.setModelMarkers(activeModel, "lfcode-lsp", [])
            })
        }, 300)

        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!editor) return
    editor.updateOptions(editorOptions())
  })

  createEffect(
    on(
      [ready, failed, () => props.path, () => props.value, resolvedLanguage, serverLspTick],
      ([isReady, isFailed]) => {
        if (!isReady || isFailed) {
          symbolRequestToken += 1
          setDocumentSymbols([])
          return
        }
        const timer = setTimeout(() => {
          void refreshDocumentSymbols()
        }, 250)
        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!host) return
    ;(
      host as HTMLDivElement & { __lfcodeCodeEditorAutomation?: LfcodeCodeEditorAutomationHandle }
    ).__lfcodeCodeEditorAutomation = automationHandle()
  })

  createEffect(() => {
    if (!props.onCommandHandle) return
    props.onCommandHandle(ready() && !failed() ? commandHandle() : undefined)
  })

  const goToDiagnostic = (item: CodeEditorDiagnosticItem) => {
    if (!editor) return
    const position = {
      lineNumber: item.line,
      column: item.column,
    }
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }

  onCleanup(() => {
    setupToken += 1
    props.onCommandHandle?.(undefined)
    if (host) {
      ;(
        host as HTMLDivElement & { __lfcodeCodeEditorAutomation?: LfcodeCodeEditorAutomationHandle }
      ).__lfcodeCodeEditorAutomation = undefined
    }
    symbolRequestToken += 1
    setDocumentSymbols([])
    disposeEditor()
  })

  return (
    <div
      class="relative flex h-full min-h-52 w-full flex-col overflow-hidden rounded-lg border border-border-weak-base bg-background-base"
      data-prevent-autofocus
      data-editable-surface="code-editor"
      data-editor-ready={ready() ? "true" : "false"}
      data-editor-failed={failed() ? "true" : "false"}
      data-editor-failure-message={failureMessage() ?? ""}
    >
      <Show when={!ready() && !failed()}>
        <div class="absolute inset-0 z-10 flex items-center justify-center text-12-regular text-text-weak">
          Loading editor...
        </div>
      </Show>
      <Show when={failed()}>
        <div class="absolute inset-0 z-10">
          <BasicCodeEditor
            value={fallbackValue()}
            preset={props.preset}
            readonly={props.readonly}
            onInput={(value) => {
              fallbackPath = props.path
              setFallbackValue(value)
              setFallbackDirty(true)
              setRecoveringFallback(true)
              recordEditorDocumentFallbackChange({ path: props.path, value })
              props.onInput(value)
            }}
            onSave={saveEditor}
          />
        </div>
      </Show>
      <Show when={failed() && failureMessage()}>
        {(message) => (
          <div
            data-automation-id="code-editor-phase0-error"
            class="absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-3 rounded-md border border-status-warning/30 bg-background-base/95 px-3 py-2 text-[11px] text-text-weak shadow-sm"
          >
            <span class="min-w-0 break-words">{message()}</span>
            <button
              type="button"
              class="shrink-0 rounded border border-border-weak-base px-2 py-1 text-text-primary hover:bg-surface-secondary"
              onClick={() => void retryEditor()}
            >
              {language.t("common.retry")}
            </button>
          </div>
        )}
      </Show>
      <Show when={!failed() && lspDownloadPrompt()}>
        {(prompt) => (
          <div class="absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-3 rounded-md border border-status-warning/30 bg-background-base/95 px-3 py-2 text-[11px] text-text-weak shadow-sm">
            <span class="min-w-0 break-words">
              {lspDownloadError() ??
                language.t("settings.editor.intellisense.download.prompt", { server: prompt().name })}
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                class="rounded border border-border-weak-base px-2 py-1 text-text-primary hover:bg-surface-secondary disabled:opacity-50"
                disabled={lspDownloading()}
                onClick={() => void enableServerLsp()}
              >
                {lspDownloading()
                  ? language.t("settings.editor.intellisense.download.starting")
                  : language.t("settings.editor.intellisense.download.start")}
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 hover:bg-surface-secondary"
                onClick={() => setLspDownloadPrompt(undefined)}
              >
                {language.t("settings.editor.intellisense.download.later")}
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 hover:bg-surface-secondary"
                onClick={() => {
                  suppressLspDownload(prompt().id)
                  setLspDownloadPrompt(undefined)
                }}
              >
                {language.t("settings.editor.intellisense.download.never")}
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={capabilities().showStatusBar && breadcrumbSymbols().length > 0}>
        <div class="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-weak-base bg-surface-secondary/60 px-3 text-[11px] text-text-weak">
          {breadcrumbSymbols().map((item, index) => (
            <>
              <Show when={index > 0}>
                <span class="shrink-0 text-text-faint">/</span>
              </Show>
              <button
                type="button"
                class="max-w-44 shrink-0 truncate rounded px-1.5 py-0.5 transition hover:bg-background-base hover:text-text-primary"
                title={item.detail ? `${item.label} • ${item.detail}` : item.label}
                onClick={() => commandHandle().revealSelection(item.selection)}
              >
                {item.label}
              </button>
            </>
          ))}
        </div>
      </Show>
      <div ref={host} data-automation-id="code-editor-phase0" class="min-h-0 flex-1" />
      <Show when={capabilities().showStatusBar && diagnosticsOpen() && diagnostics().items.length > 0}>
        <div class="max-h-44 overflow-auto border-t border-border-weak-base bg-background-stronger px-3 py-2">
          <div class="mb-2 flex items-center justify-between text-[11px] text-text-weak">
            <span>{language.t("codeEditor.problems.title")}</span>
            <button
              type="button"
              class="rounded px-1 py-0.5 text-text-weak transition hover:bg-background-base hover:text-text-primary"
              onClick={() => setDiagnosticsOpen(false)}
            >
              {language.t("codeEditor.problems.hide")}
            </button>
          </div>
          <div class="flex flex-col gap-1.5">
            {diagnostics().items.map((item) => (
              <button
                type="button"
                class="flex w-full flex-col items-start rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-left transition hover:border-border-strong-base hover:bg-background-base/80"
                onClick={() => goToDiagnostic(item)}
              >
                <div class="flex w-full items-center justify-between gap-3 text-[11px]">
                  <span class={item.severity === "error" ? "text-text-danger" : "text-status-warning"}>
                    {language.t(
                      item.severity === "error" ? "codeEditor.problems.error" : "codeEditor.problems.warning",
                    )}
                  </span>
                  <span class="shrink-0 text-text-weak">
                    {language.t("codeEditor.problems.location", {
                      line: item.line,
                      column: item.column,
                    })}
                  </span>
                </div>
                <div class="mt-1 line-clamp-3 text-[12px] text-text-primary">{item.message}</div>
                <Show when={item.source || item.code}>
                  <div class="mt-1 text-[11px] text-text-weak">
                    {[item.source, item.code].filter(Boolean).join(" • ")}
                  </div>
                </Show>
              </button>
            ))}
          </div>
        </div>
      </Show>
      <Show when={capabilities().showStatusBar}>
        <div class="flex h-7 shrink-0 items-center justify-between border-t border-border-weak-base bg-surface-secondary px-3 text-[11px] text-text-weak">
          <div class="min-w-0 flex items-center gap-3">
            <span class="truncate">
              {language.t("codeEditor.status.language", { language: resolvedLanguage() ?? "text" })}
            </span>
            <Show when={diagnostics().errors > 0 || diagnostics().warnings > 0}>
              <button
                type="button"
                class="truncate rounded px-1 py-0.5 transition hover:bg-background-base hover:text-text-primary"
                onClick={() => setDiagnosticsOpen((open) => !open)}
                aria-expanded={diagnosticsOpen()}
              >
                {language.t("codeEditor.status.diagnostics", {
                  errors: diagnostics().errors,
                  warnings: diagnostics().warnings,
                })}
              </button>
            </Show>
          </div>
          <span class="shrink-0 tabular-nums">
            {language.t("codeEditor.status.cursor", {
              line: cursor().line,
              column: cursor().column,
            })}
          </span>
        </div>
      </Show>
    </div>
  )
}
