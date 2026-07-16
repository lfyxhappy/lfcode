import { createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
import { Icon, type IconProps } from "@lfcode-ai/ui/icon"
import { Popover } from "@lfcode-ai/ui/popover"
import type { CodeEditorCommandHandle, CodeEditorHoverItem } from "@/components/code-editor/core/command-handle"
import DropdownMenu from "@/components/code-editor/core/dropdown-menu"
import { useLanguage } from "@/context/language"

export function CodeEditorCommandStrip(props: {
  handle?: CodeEditorCommandHandle
  compact?: boolean
}) {
  type IconName = IconProps["name"]
  type CommandAction = {
    id?: string
    icon: IconName
    label: string
    run: () => void
  }
  type CommandSection = {
    title: string
    icon: IconName
    items: CommandAction[]
  }

  const language = useLanguage()
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const [outlineLoading, setOutlineLoading] = createSignal(false)
  const [outlineError, setOutlineError] = createSignal<string>()
  const [symbols, setSymbols] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getDocumentSymbols"]>>>([])
  const [definitionsOpen, setDefinitionsOpen] = createSignal(false)
  const [definitionsLoading, setDefinitionsLoading] = createSignal(false)
  const [definitionsError, setDefinitionsError] = createSignal<string>()
  const [definitions, setDefinitions] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getDefinitions"]>>>([])
  const [declarationsOpen, setDeclarationsOpen] = createSignal(false)
  const [declarationsLoading, setDeclarationsLoading] = createSignal(false)
  const [declarationsError, setDeclarationsError] = createSignal<string>()
  const [declarations, setDeclarations] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getDeclarations"]>>>([])
  const [typeDefinitionsOpen, setTypeDefinitionsOpen] = createSignal(false)
  const [typeDefinitionsLoading, setTypeDefinitionsLoading] = createSignal(false)
  const [typeDefinitionsError, setTypeDefinitionsError] = createSignal<string>()
  const [typeDefinitions, setTypeDefinitions] = createSignal<
    Awaited<ReturnType<CodeEditorCommandHandle["getTypeDefinitions"]>>
  >([])
  const [implementationsOpen, setImplementationsOpen] = createSignal(false)
  const [implementationsLoading, setImplementationsLoading] = createSignal(false)
  const [implementationsError, setImplementationsError] = createSignal<string>()
  const [implementations, setImplementations] = createSignal<
    Awaited<ReturnType<CodeEditorCommandHandle["getImplementations"]>>
  >([])
  const [referencesOpen, setReferencesOpen] = createSignal(false)
  const [referencesLoading, setReferencesLoading] = createSignal(false)
  const [referencesError, setReferencesError] = createSignal<string>()
  const [references, setReferences] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getReferences"]>>>([])
  const [documentHighlightsOpen, setDocumentHighlightsOpen] = createSignal(false)
  const [documentHighlightsLoading, setDocumentHighlightsLoading] = createSignal(false)
  const [documentHighlightsError, setDocumentHighlightsError] = createSignal<string>()
  const [documentHighlights, setDocumentHighlights] = createSignal<
    Awaited<ReturnType<CodeEditorCommandHandle["getDocumentHighlights"]>>
  >([])
  const [hoverOpen, setHoverOpen] = createSignal(false)
  const [hoverLoading, setHoverLoading] = createSignal(false)
  const [hoverError, setHoverError] = createSignal<string>()
  const [hoverItems, setHoverItems] = createSignal<CodeEditorHoverItem[]>([])
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = createSignal(false)
  const [workspaceSymbolsError, setWorkspaceSymbolsError] = createSignal<string>()
  const [workspaceSymbolsQuery, setWorkspaceSymbolsQuery] = createSignal("")
  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = createSignal(false)
  const [workspaceSymbols, setWorkspaceSymbols] = createSignal<
    Awaited<ReturnType<CodeEditorCommandHandle["getWorkspaceSymbols"]>>
  >([])
  const [incomingCallsOpen, setIncomingCallsOpen] = createSignal(false)
  const [incomingCallsLoading, setIncomingCallsLoading] = createSignal(false)
  const [incomingCallsError, setIncomingCallsError] = createSignal<string>()
  const [incomingCalls, setIncomingCalls] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getIncomingCalls"]>>>([])
  const [outgoingCallsOpen, setOutgoingCallsOpen] = createSignal(false)
  const [outgoingCallsLoading, setOutgoingCallsLoading] = createSignal(false)
  const [outgoingCallsError, setOutgoingCallsError] = createSignal<string>()
  const [outgoingCalls, setOutgoingCalls] = createSignal<Awaited<ReturnType<CodeEditorCommandHandle["getOutgoingCalls"]>>>([])
  let workspaceSymbolsTimer: ReturnType<typeof setTimeout> | undefined
  let workspaceSymbolsRequestID = 0

  const label = () => ({
    save: language.t("codeEditor.actions.save"),
    undo: language.t("codeEditor.actions.undo"),
    redo: language.t("codeEditor.actions.redo"),
    back: language.t("codeEditor.actions.back"),
    forward: language.t("codeEditor.actions.forward"),
    commandPalette: language.t("codeEditor.actions.commandPalette"),
    quickOutline: language.t("codeEditor.actions.quickOutline"),
    workspaceSymbols: language.t("codeEditor.actions.workspaceSymbols"),
    workspaceSymbolsPlaceholder: language.t("codeEditor.actions.workspaceSymbolsPlaceholder"),
    workspaceSymbolsPrompt: language.t("codeEditor.actions.workspaceSymbolsPrompt"),
    workspaceSymbolsEmpty: language.t("codeEditor.actions.workspaceSymbolsEmpty"),
    incomingCalls: language.t("codeEditor.actions.incomingCalls"),
    incomingCallsEmpty: language.t("codeEditor.actions.incomingCallsEmpty"),
    outgoingCalls: language.t("codeEditor.actions.outgoingCalls"),
    outgoingCallsEmpty: language.t("codeEditor.actions.outgoingCallsEmpty"),
    find: language.t("codeEditor.actions.find"),
    replace: language.t("codeEditor.actions.replace"),
    previousMatch: language.t("codeEditor.actions.previousMatch"),
    nextMatch: language.t("codeEditor.actions.nextMatch"),
    gotoLine: language.t("codeEditor.actions.gotoLine"),
    quickFix: language.t("codeEditor.actions.quickFix"),
    rename: language.t("codeEditor.actions.rename"),
    showHover: language.t("codeEditor.actions.showHover"),
    showHoverEmpty: language.t("codeEditor.actions.showHoverEmpty"),
    showHoverLoading: language.t("codeEditor.actions.showHoverLoading"),
    showHoverFailed: language.t("codeEditor.actions.showHoverFailed"),
    triggerSuggest: language.t("codeEditor.actions.triggerSuggest"),
    triggerParameterHints: language.t("codeEditor.actions.triggerParameterHints"),
    openProblems: language.t("codeEditor.actions.openProblems"),
    nextProblem: language.t("codeEditor.actions.nextProblem"),
    previousProblem: language.t("codeEditor.actions.previousProblem"),
    organizeImports: language.t("codeEditor.actions.organizeImports"),
    expandSelection: language.t("codeEditor.actions.expandSelection"),
    shrinkSelection: language.t("codeEditor.actions.shrinkSelection"),
    moveLineUp: language.t("codeEditor.actions.moveLineUp"),
    moveLineDown: language.t("codeEditor.actions.moveLineDown"),
    copyLineUp: language.t("codeEditor.actions.copyLineUp"),
    copyLineDown: language.t("codeEditor.actions.copyLineDown"),
    deleteLine: language.t("codeEditor.actions.deleteLine"),
    addNextMatchToSelection: language.t("codeEditor.actions.addNextMatchToSelection"),
    duplicateSelection: language.t("codeEditor.actions.duplicateSelection"),
    insertCursorAbove: language.t("codeEditor.actions.insertCursorAbove"),
    insertCursorBelow: language.t("codeEditor.actions.insertCursorBelow"),
    joinLines: language.t("codeEditor.actions.joinLines"),
    trimTrailingWhitespace: language.t("codeEditor.actions.trimTrailingWhitespace"),
    toggleWordWrap: language.t("codeEditor.actions.toggleWordWrap"),
    foldCurrent: language.t("codeEditor.actions.foldCurrent"),
    unfoldCurrent: language.t("codeEditor.actions.unfoldCurrent"),
    foldAll: language.t("codeEditor.actions.foldAll"),
    unfoldAll: language.t("codeEditor.actions.unfoldAll"),
    peekDefinition: language.t("codeEditor.actions.peekDefinition"),
    peekTypeDefinition: language.t("codeEditor.actions.peekTypeDefinition"),
    peekImplementation: language.t("codeEditor.actions.peekImplementation"),
    peekReferences: language.t("codeEditor.actions.peekReferences"),
    format: language.t("codeEditor.actions.format"),
    formatSelection: language.t("codeEditor.actions.formatSelection"),
    comment: language.t("codeEditor.actions.comment"),
    blockComment: language.t("codeEditor.actions.blockComment"),
    sectionSearch: language.t("codeEditor.sections.search"),
    sectionNavigate: language.t("codeEditor.sections.navigate"),
    sectionEdit: language.t("codeEditor.sections.edit"),
    sectionTools: language.t("codeEditor.sections.tools"),
    sectionView: language.t("codeEditor.sections.view"),
    sectionPeek: language.t("codeEditor.sections.peek"),
    definition: language.t("codeEditor.actions.definition"),
    definitionEmpty: language.t("codeEditor.actions.definitionEmpty"),
    typeDefinition: language.t("codeEditor.actions.typeDefinition"),
    typeDefinitionEmpty: language.t("codeEditor.actions.typeDefinitionEmpty"),
    implementation: language.t("codeEditor.actions.implementation"),
    implementationEmpty: language.t("codeEditor.actions.implementationEmpty"),
    references: language.t("codeEditor.actions.references"),
    referencesEmpty: language.t("codeEditor.actions.referencesEmpty"),
    documentHighlights: language.t("codeEditor.actions.documentHighlights"),
    documentHighlightsEmpty: language.t("codeEditor.actions.documentHighlightsEmpty"),
    declaration: language.t("codeEditor.actions.declaration"),
    declarationEmpty: language.t("codeEditor.actions.declarationEmpty"),
    navigationLoading: language.t("codeEditor.actions.navigationLoading"),
    navigationFailed: language.t("codeEditor.actions.navigationFailed"),
    outline: language.t("codeEditor.actions.outline"),
    outlineEmpty: language.t("codeEditor.actions.outlineEmpty"),
    outlineLoading: language.t("codeEditor.actions.outlineLoading"),
    outlineFailed: language.t("codeEditor.actions.outlineFailed"),
  })

  const toolbarIconClass = () => (props.compact ? "size-3.5" : "size-4")
  const toolbarButtonClass = () => (props.compact ? "size-7 min-w-7 rounded-lg p-0" : "size-8 min-w-8 rounded-lg p-0")
  const hiddenPopoverTriggerClass = "pointer-events-none absolute right-0 top-0 h-px w-px overflow-hidden opacity-0"
  const menuContentClass =
    "min-w-[280px] max-h-[min(78vh,720px)] overflow-auto rounded-xl border border-border-weak-base bg-background-panel p-1.5 shadow-2xl"
  const menuItemClass = "rounded-lg"
  const menuSectionLabelClass = "px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-weak first:pt-0"
  const menuRowClass = "flex items-center gap-2.5"
  const menuItemIconClass = "size-3.5 shrink-0 text-icon-weak-base"
  const renderMenuLabel = (input: { icon: IconName; label: string }) => (
    <div class={menuRowClass}>
      <Icon name={input.icon} class={menuItemIconClass} />
      <DropdownMenu.ItemLabel>{input.label}</DropdownMenu.ItemLabel>
    </div>
  )
  const renderSubTriggerLabel = (input: { icon: IconName; label: string }) => (
    <div class="flex min-w-0 items-center gap-2.5">
      <Icon name={input.icon} class={menuItemIconClass} />
      <span class="truncate">{input.label}</span>
    </div>
  )

  const searchActions = (): CommandAction[] => [
    { id: "code-editor-find", icon: "magnifying-glass", label: label().find, run: () => void props.handle?.openFind() },
    { id: "code-editor-replace", icon: "edit-small-2", label: label().replace, run: () => void props.handle?.openReplace() },
    { id: "code-editor-find-previous", icon: "arrow-left", label: label().previousMatch, run: () => void props.handle?.findPrevious() },
    { id: "code-editor-find-next", icon: "arrow-right", label: label().nextMatch, run: () => void props.handle?.findNext() },
    { id: "code-editor-goto-line", icon: "arrow-down-to-line", label: label().gotoLine, run: () => void props.handle?.openGoToLine() },
    { id: "code-editor-quick-fix", icon: "glasses", label: label().quickFix, run: () => void props.handle?.openQuickFix() },
  ]

  const navigateActions = (): CommandAction[] => [
    { id: "code-editor-back", icon: "chevron-left", label: label().back, run: () => void props.handle?.navigateBack() },
    { id: "code-editor-forward", icon: "chevron-right", label: label().forward, run: () => void props.handle?.navigateForward() },
    { icon: "link", label: label().definition, run: () => void loadDefinitions() },
    { icon: "link", label: label().declaration, run: () => void loadDeclarations() },
    { icon: "link", label: label().typeDefinition, run: () => void loadTypeDefinitions() },
    { icon: "code-lines", label: label().implementation, run: () => void loadImplementations() },
    { icon: "copy", label: label().references, run: () => void loadReferences() },
    { icon: "glasses", label: label().documentHighlights, run: () => void loadDocumentHighlights() },
    { icon: "arrow-left", label: label().incomingCalls, run: () => void loadIncomingCalls() },
    { icon: "arrow-right", label: label().outgoingCalls, run: () => void loadOutgoingCalls() },
  ]

  const editActions = (): CommandAction[] => [
    { icon: "pencil-line", label: label().rename, run: () => void props.handle?.renameSymbol() },
    { icon: "code-lines", label: label().organizeImports, run: () => void props.handle?.organizeImports() },
    { icon: "align-right", label: label().format, run: () => void props.handle?.formatDocument() },
    { icon: "selector", label: label().formatSelection, run: () => void props.handle?.formatSelection() },
    { icon: "comment", label: label().comment, run: () => void props.handle?.toggleLineComment() },
    { icon: "bubble-5", label: label().blockComment, run: () => void props.handle?.toggleBlockComment() },
    { icon: "expand", label: label().expandSelection, run: () => void props.handle?.expandSelection() },
    { icon: "collapse", label: label().shrinkSelection, run: () => void props.handle?.shrinkSelection() },
    { icon: "plus-small", label: label().addNextMatchToSelection, run: () => void props.handle?.addNextMatchToSelection() },
    { icon: "copy", label: label().duplicateSelection, run: () => void props.handle?.duplicateSelection() },
    { icon: "arrow-up", label: label().insertCursorAbove, run: () => void props.handle?.insertCursorAbove() },
    { icon: "arrow-down-to-line", label: label().insertCursorBelow, run: () => void props.handle?.insertCursorBelow() },
    { icon: "arrow-up", label: label().moveLineUp, run: () => void props.handle?.moveLineUp() },
    { icon: "arrow-down-to-line", label: label().moveLineDown, run: () => void props.handle?.moveLineDown() },
    { icon: "copy", label: label().copyLineUp, run: () => void props.handle?.copyLineUp() },
    { icon: "copy", label: label().copyLineDown, run: () => void props.handle?.copyLineDown() },
    { icon: "trash", label: label().deleteLine, run: () => void props.handle?.deleteLine() },
    { icon: "align-right", label: label().joinLines, run: () => void props.handle?.joinLines() },
    { icon: "checklist", label: label().trimTrailingWhitespace, run: () => void props.handle?.trimTrailingWhitespace() },
  ]

  const toolActions = (): CommandAction[] => [
    { icon: "menu", label: label().commandPalette, run: () => void props.handle?.openCommandPalette() },
    { icon: "bullet-list", label: label().quickOutline, run: () => void props.handle?.openQuickOutline() },
    { icon: "glasses", label: label().showHover, run: () => void loadHover() },
    { icon: "brain", label: label().triggerSuggest, run: () => void props.handle?.triggerSuggest() },
    { icon: "help", label: label().triggerParameterHints, run: () => void props.handle?.triggerParameterHints() },
    { icon: "warning", label: label().openProblems, run: () => void props.handle?.openProblems() },
    { icon: "arrow-left", label: label().previousProblem, run: () => void props.handle?.previousProblem() },
    { icon: "arrow-right", label: label().nextProblem, run: () => void props.handle?.nextProblem() },
  ]

  const viewActions = (): CommandAction[] => [
    { icon: "collapse", label: label().foldCurrent, run: () => void props.handle?.foldCurrent() },
    { icon: "expand", label: label().unfoldCurrent, run: () => void props.handle?.unfoldCurrent() },
    { icon: "collapse", label: label().foldAll, run: () => void props.handle?.foldAll() },
    { icon: "expand", label: label().unfoldAll, run: () => void props.handle?.unfoldAll() },
    { icon: "align-right", label: label().toggleWordWrap, run: () => void props.handle?.toggleWordWrap() },
  ]

  const peekActions = (): CommandAction[] => [
    { icon: "link", label: label().peekDefinition, run: () => void props.handle?.peekDefinition() },
    { icon: "link", label: label().declaration, run: () => void props.handle?.peekDeclaration() },
    { icon: "link", label: label().peekTypeDefinition, run: () => void props.handle?.peekTypeDefinition() },
    { icon: "code-lines", label: label().peekImplementation, run: () => void props.handle?.peekImplementation() },
    { icon: "copy", label: label().peekReferences, run: () => void props.handle?.peekReferences() },
  ]

  const renderMenuActions = (items: CommandAction[]) => (
    <For each={items}>
      {(action) => (
        <DropdownMenu.Item class={menuItemClass} data-automation-id={action.id} onSelect={action.run}>
          {renderMenuLabel({ icon: action.icon, label: action.label })}
        </DropdownMenu.Item>
      )}
    </For>
  )

  const renderMenuSection = (section: CommandSection) => (
    <>
      <div class={menuSectionLabelClass}>{section.title}</div>
      {renderMenuActions(section.items)}
    </>
  )

  const searchSection = (): CommandSection => ({
    title: label().sectionSearch,
    icon: "magnifying-glass",
    items: searchActions(),
  })

  const overflowSections = (): CommandSection[] => [
    { title: label().sectionNavigate, icon: "bullet-list", items: navigateActions() },
    { title: label().sectionEdit, icon: "pencil-line", items: editActions() },
    { title: label().sectionTools, icon: "sliders", items: toolActions() },
    { title: label().sectionView, icon: "eye", items: viewActions() },
    { title: label().sectionPeek, icon: "glasses", items: peekActions() },
  ]

  const loadOutline = async () => {
    if (!props.handle) return
    setOutlineLoading(true)
    setOutlineError(undefined)
    try {
      setSymbols(await props.handle.getDocumentSymbols())
    } catch (error) {
      setSymbols([])
      setOutlineError(error instanceof Error ? error.message : String(error))
    } finally {
      setOutlineLoading(false)
    }
  }

  const loadHover = async () => {
    if (!props.handle) return
    setHoverLoading(true)
    setHoverError(undefined)
    try {
      setHoverItems(await props.handle.getHover())
      setHoverOpen(true)
    } catch (error) {
      setHoverItems([])
      setHoverError(error instanceof Error ? error.message : String(error))
      setHoverOpen(true)
    } finally {
      setHoverLoading(false)
    }
  }

  const loadWorkspaceSymbols = async (query: string) => {
    if (!props.handle) return
    const trimmed = query.trim()
    setWorkspaceSymbolsQuery(query)
    setWorkspaceSymbolsError(undefined)
    if (!trimmed) {
      setWorkspaceSymbols([])
      setWorkspaceSymbolsLoading(false)
      return
    }
    const requestID = ++workspaceSymbolsRequestID
    setWorkspaceSymbolsLoading(true)
    try {
      const items = await props.handle.getWorkspaceSymbols(trimmed)
      if (requestID !== workspaceSymbolsRequestID) return
      setWorkspaceSymbols(items)
    } catch (error) {
      if (requestID !== workspaceSymbolsRequestID) return
      setWorkspaceSymbols([])
      setWorkspaceSymbolsError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestID === workspaceSymbolsRequestID) {
        setWorkspaceSymbolsLoading(false)
      }
    }
  }

  const queueWorkspaceSymbolSearch = (query: string) => {
    setWorkspaceSymbolsQuery(query)
    if (workspaceSymbolsTimer) clearTimeout(workspaceSymbolsTimer)
    workspaceSymbolsTimer = setTimeout(() => {
      void loadWorkspaceSymbols(query)
    }, 180)
  }

  const loadDefinitions = async () => {
    if (!props.handle) return
    setDefinitionsLoading(true)
    setDefinitionsError(undefined)
    try {
      const items = await props.handle.getDefinitions()
      setDefinitions(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setDefinitionsOpen(false)
        return
      }
      setDefinitionsOpen(true)
    } catch (error) {
      setDefinitions([])
      setDefinitionsError(error instanceof Error ? error.message : String(error))
      setDefinitionsOpen(true)
    } finally {
      setDefinitionsLoading(false)
    }
  }

  const loadDeclarations = async () => {
    if (!props.handle) return
    setDeclarationsLoading(true)
    setDeclarationsError(undefined)
    try {
      const items = await props.handle.getDeclarations()
      setDeclarations(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setDeclarationsOpen(false)
        return
      }
      setDeclarationsOpen(true)
    } catch (error) {
      setDeclarations([])
      setDeclarationsError(error instanceof Error ? error.message : String(error))
      setDeclarationsOpen(true)
    } finally {
      setDeclarationsLoading(false)
    }
  }

  const loadIncomingCalls = async () => {
    if (!props.handle) return
    setIncomingCallsLoading(true)
    setIncomingCallsError(undefined)
    try {
      const items = await props.handle.getIncomingCalls()
      setIncomingCalls(items)
      setIncomingCallsOpen(true)
    } catch (error) {
      setIncomingCalls([])
      setIncomingCallsError(error instanceof Error ? error.message : String(error))
      setIncomingCallsOpen(true)
    } finally {
      setIncomingCallsLoading(false)
    }
  }

  const loadOutgoingCalls = async () => {
    if (!props.handle) return
    setOutgoingCallsLoading(true)
    setOutgoingCallsError(undefined)
    try {
      const items = await props.handle.getOutgoingCalls()
      setOutgoingCalls(items)
      setOutgoingCallsOpen(true)
    } catch (error) {
      setOutgoingCalls([])
      setOutgoingCallsError(error instanceof Error ? error.message : String(error))
      setOutgoingCallsOpen(true)
    } finally {
      setOutgoingCallsLoading(false)
    }
  }

  const loadReferences = async () => {
    if (!props.handle) return
    setReferencesLoading(true)
    setReferencesError(undefined)
    try {
      const items = await props.handle.getReferences()
      setReferences(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setReferencesOpen(false)
        return
      }
      setReferencesOpen(true)
    } catch (error) {
      setReferences([])
      setReferencesError(error instanceof Error ? error.message : String(error))
      setReferencesOpen(true)
    } finally {
      setReferencesLoading(false)
    }
  }

  const loadTypeDefinitions = async () => {
    if (!props.handle) return
    setTypeDefinitionsLoading(true)
    setTypeDefinitionsError(undefined)
    try {
      const items = await props.handle.getTypeDefinitions()
      setTypeDefinitions(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setTypeDefinitionsOpen(false)
        return
      }
      setTypeDefinitionsOpen(true)
    } catch (error) {
      setTypeDefinitions([])
      setTypeDefinitionsError(error instanceof Error ? error.message : String(error))
      setTypeDefinitionsOpen(true)
    } finally {
      setTypeDefinitionsLoading(false)
    }
  }

  const loadDocumentHighlights = async () => {
    if (!props.handle) return
    setDocumentHighlightsLoading(true)
    setDocumentHighlightsError(undefined)
    try {
      const items = await props.handle.getDocumentHighlights()
      setDocumentHighlights(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setDocumentHighlightsOpen(false)
        return
      }
      setDocumentHighlightsOpen(true)
    } catch (error) {
      setDocumentHighlights([])
      setDocumentHighlightsError(error instanceof Error ? error.message : String(error))
      setDocumentHighlightsOpen(true)
    } finally {
      setDocumentHighlightsLoading(false)
    }
  }

  const loadImplementations = async () => {
    if (!props.handle) return
    setImplementationsLoading(true)
    setImplementationsError(undefined)
    try {
      const items = await props.handle.getImplementations()
      setImplementations(items)
      if (items.length === 1) {
        await props.handle.openNavigationTarget(items[0])
        setImplementationsOpen(false)
        return
      }
      setImplementationsOpen(true)
    } catch (error) {
      setImplementations([])
      setImplementationsError(error instanceof Error ? error.message : String(error))
      setImplementationsOpen(true)
    } finally {
      setImplementationsLoading(false)
    }
  }

  const renderNavigationList = (input: {
    items: Awaited<ReturnType<CodeEditorCommandHandle["getDefinitions"]>>
    loading: boolean
    error?: string
    emptyLabel: string
    onSelect: (id: string) => Promise<void>
  }) => (
    <Show
      when={!input.loading}
      fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().navigationLoading}</div>}
    >
      <Show
        when={!input.error}
        fallback={
          <div class="px-3 py-2 text-12-regular text-text-danger">
            {label().navigationFailed}
            <Show when={input.error}>
              {(error) => <div class="mt-1 whitespace-pre-wrap break-words text-11-regular text-text-weak">{error()}</div>}
            </Show>
          </div>
        }
      >
        <Show when={input.items.length > 0} fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{input.emptyLabel}</div>}>
          <div class="flex max-h-[320px] flex-col gap-1 overflow-auto">
            <For each={input.items}>
              {(item) => (
                <button
                  type="button"
                  class="w-full rounded-lg px-3 py-2 text-left transition hover:bg-background-stronger"
                  onClick={() => void input.onSelect(item.id)}
                >
                  <div class="truncate text-12-medium text-text-primary">{item.label}</div>
                  <div class="mt-0.5 truncate text-11-regular text-text-weak">{item.detail}</div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Show>
  )

  const renderHoverContent = (input: { items: CodeEditorHoverItem[]; loading: boolean; error?: string }) => (
    <Show when={!input.loading} fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().showHoverLoading}</div>}>
      <Show
        when={!input.error}
        fallback={
          <div class="px-3 py-2 text-12-regular text-text-danger">
            {label().showHoverFailed}
            <Show when={input.error}>
              {(error) => <div class="mt-1 whitespace-pre-wrap break-words text-11-regular text-text-weak">{error()}</div>}
            </Show>
          </div>
        }
      >
        <Show when={input.items.length > 0} fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().showHoverEmpty}</div>}>
          <div class="flex max-h-[320px] flex-col gap-2 overflow-auto px-1 py-1">
            <For each={input.items}>
              {(item) => (
                <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2">
                  <Show
                    when={item.kind === "code"}
                    fallback={<div class="whitespace-pre-wrap break-words text-12-regular leading-6 text-text-primary">{item.text}</div>}
                  >
                    <div>
                      <Show when={item.language}>
                        {(language) => <div class="mb-2 text-[10px] uppercase tracking-[0.08em] text-text-weak">{language()}</div>}
                      </Show>
                      <pre class="overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-text-primary">
                        <code>{item.text}</code>
                      </pre>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Show>
  )

  onCleanup(() => {
    if (workspaceSymbolsTimer) clearTimeout(workspaceSymbolsTimer)
  })

  return (
    <Show when={props.handle}>
      {(handle) => (
        <div class="relative flex items-center gap-1.5">
          <Popover
            open={hoverOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setHoverOpen(false)
                return
              }
              void loadHover()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[420px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderHoverContent({
              items: hoverItems(),
              loading: hoverLoading(),
              error: hoverError(),
            })}
          </Popover>
          <Popover
            open={workspaceSymbolsOpen()}
            onOpenChange={(open) => {
              setWorkspaceSymbolsOpen(open)
              if (!open) return
              setWorkspaceSymbolsQuery("")
              setWorkspaceSymbols([])
              setWorkspaceSymbolsError(undefined)
              setWorkspaceSymbolsLoading(false)
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[380px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            <div class="flex flex-col gap-2">
              <div class="px-1 text-[10px] uppercase tracking-[0.08em] text-text-weak">{label().workspaceSymbols}</div>
              <input
                value={workspaceSymbolsQuery()}
                placeholder={label().workspaceSymbolsPlaceholder}
                class="h-9 w-full rounded-lg border border-border-weak-base bg-background-base px-3 text-12-regular text-text-primary outline-none transition placeholder:text-text-weak focus:border-border-strong-base"
                onInput={(event) => queueWorkspaceSymbolSearch(event.currentTarget.value)}
              />
              <Show
                when={workspaceSymbolsQuery().trim().length > 0}
                fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().workspaceSymbolsPrompt}</div>}
              >
                {renderNavigationList({
                  items: workspaceSymbols(),
                  loading: workspaceSymbolsLoading(),
                  error: workspaceSymbolsError(),
                  emptyLabel: label().workspaceSymbolsEmpty,
                  onSelect: async (id) => {
                    const target = workspaceSymbols().find((item) => item.id === id)
                    if (!target) return
                    setWorkspaceSymbolsOpen(false)
                    await handle().openNavigationTarget(target)
                  },
                })}
              </Show>
            </div>
          </Popover>
          <Popover
            open={declarationsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setDeclarationsOpen(false)
                return
              }
              void loadDeclarations()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: declarations(),
              loading: declarationsLoading(),
              error: declarationsError(),
              emptyLabel: label().declarationEmpty,
              onSelect: async (id) => {
                const target = declarations().find((item) => item.id === id)
                if (!target) return
                setDeclarationsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={definitionsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setDefinitionsOpen(false)
                return
              }
              void loadDefinitions()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: definitions(),
              loading: definitionsLoading(),
              error: definitionsError(),
              emptyLabel: label().definitionEmpty,
              onSelect: async (id) => {
                const target = definitions().find((item) => item.id === id)
                if (!target) return
                setDefinitionsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={incomingCallsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setIncomingCallsOpen(false)
                return
              }
              void loadIncomingCalls()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: incomingCalls(),
              loading: incomingCallsLoading(),
              error: incomingCallsError(),
              emptyLabel: label().incomingCallsEmpty,
              onSelect: async (id) => {
                const target = incomingCalls().find((item) => item.id === id)
                if (!target) return
                setIncomingCallsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={outgoingCallsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setOutgoingCallsOpen(false)
                return
              }
              void loadOutgoingCalls()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: outgoingCalls(),
              loading: outgoingCallsLoading(),
              error: outgoingCallsError(),
              emptyLabel: label().outgoingCallsEmpty,
              onSelect: async (id) => {
                const target = outgoingCalls().find((item) => item.id === id)
                if (!target) return
                setOutgoingCallsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={referencesOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setReferencesOpen(false)
                return
              }
              void loadReferences()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: references(),
              loading: referencesLoading(),
              error: referencesError(),
              emptyLabel: label().referencesEmpty,
              onSelect: async (id) => {
                const target = references().find((item) => item.id === id)
                if (!target) return
                setReferencesOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={documentHighlightsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setDocumentHighlightsOpen(false)
                return
              }
              void loadDocumentHighlights()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: documentHighlights(),
              loading: documentHighlightsLoading(),
              error: documentHighlightsError(),
              emptyLabel: label().documentHighlightsEmpty,
              onSelect: async (id) => {
                const target = documentHighlights().find((item) => item.id === id)
                if (!target) return
                setDocumentHighlightsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={typeDefinitionsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setTypeDefinitionsOpen(false)
                return
              }
              void loadTypeDefinitions()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: typeDefinitions(),
              loading: typeDefinitionsLoading(),
              error: typeDefinitionsError(),
              emptyLabel: label().typeDefinitionEmpty,
              onSelect: async (id) => {
                const target = typeDefinitions().find((item) => item.id === id)
                if (!target) return
                setTypeDefinitionsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Popover
            open={implementationsOpen()}
            onOpenChange={(open) => {
              if (!open) {
                setImplementationsOpen(false)
                return
              }
              void loadImplementations()
            }}
            triggerAs="button"
            triggerProps={{
              type: "button",
              class: hiddenPopoverTriggerClass,
            }}
            trigger={<span />}
            class="[&_[data-slot=popover-body]]:p-1.5 w-[360px] max-w-[calc(100vw-40px)] rounded-xl border border-border-weak-base bg-background-panel shadow-2xl"
            placement="bottom-end"
            gutter={6}
          >
            {renderNavigationList({
              items: implementations(),
              loading: implementationsLoading(),
              error: implementationsError(),
              emptyLabel: label().implementationEmpty,
              onSelect: async (id) => {
                const target = implementations().find((item) => item.id === id)
                if (!target) return
                setImplementationsOpen(false)
                await handle().openNavigationTarget(target)
              },
            })}
          </Popover>
          <Button
            type="button"
            size="small"
            variant="ghost"
            class={toolbarButtonClass()}
            title={label().undo}
            aria-label={label().undo}
            data-automation-id="code-editor-undo"
            onClick={() => void props.handle?.undo()}
          >
            <Icon name="arrow-left" class={toolbarIconClass()} />
          </Button>
          <Button
            type="button"
            size="small"
            variant="ghost"
            class={toolbarButtonClass()}
            title={label().redo}
            aria-label={label().redo}
            data-automation-id="code-editor-redo"
            onClick={() => void props.handle?.redo()}
          >
            <Icon name="arrow-right" class={toolbarIconClass()} />
          </Button>
          <DropdownMenu gutter={6} placement="bottom-end">
            <DropdownMenu.Trigger
              as={Button}
              type="button"
              size="small"
              variant="ghost"
              class={toolbarButtonClass()}
              title={label().sectionSearch}
              aria-label={label().sectionSearch}
              data-automation-id="code-editor-search-actions"
            >
              <Icon name="magnifying-glass" class={toolbarIconClass()} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="min-w-[240px] rounded-xl border border-border-weak-base bg-background-panel p-1.5 shadow-2xl">
                {renderMenuSection(searchSection())}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          <DropdownMenu gutter={6} placement="bottom-end">
            <DropdownMenu.Trigger
              as={Button}
              type="button"
              size="small"
              variant="ghost"
              class={toolbarButtonClass()}
              title={language.t("common.moreOptions")}
              aria-label={language.t("common.moreOptions")}
              data-automation-id="code-editor-more-actions"
            >
              <Icon name="dot-grid" class={toolbarIconClass()} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class={menuContentClass}>
                <DropdownMenu.Item class={menuItemClass} data-automation-id="code-editor-outline-button" onSelect={() => setOutlineOpen(true)}>
                  {renderMenuLabel({ icon: "bullet-list", label: label().outline })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class={menuItemClass}
                  data-automation-id="code-editor-workspace-symbols"
                  onSelect={() => setWorkspaceSymbolsOpen(true)}
                >
                  {renderMenuLabel({ icon: "magnifying-glass-menu", label: label().workspaceSymbols })}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={menuItemClass} onSelect={() => void loadHover()}>
                  {renderMenuLabel({ icon: "glasses", label: label().showHover })}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={menuItemClass} onSelect={() => void props.handle?.openCommandPalette()}>
                  {renderMenuLabel({ icon: "menu", label: label().commandPalette })}
                </DropdownMenu.Item>
                <DropdownMenu.Separator class="my-1.5 h-px bg-border-weak-base" />
                <For each={overflowSections()}>
                  {(section) => (
                    <DropdownMenu.Sub>
                      <DropdownMenu.SubTrigger class={menuItemClass}>
                        {renderSubTriggerLabel({ icon: section.icon, label: section.title })}
                      </DropdownMenu.SubTrigger>
                      <DropdownMenu.SubContent class={menuContentClass}>
                        {renderMenuSection(section)}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Sub>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          <DropdownMenu
            placement="bottom-end"
            gutter={6}
            open={outlineOpen()}
            onOpenChange={(open) => {
              setOutlineOpen(open)
              if (open) void loadOutline()
            }}
          >
            <DropdownMenu.Trigger
              as="button"
              type="button"
              class={hiddenPopoverTriggerClass}
              aria-hidden="true"
              tabIndex={-1}
            >
              <span />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="min-w-[260px] max-w-[360px] max-h-[320px] overflow-auto rounded-xl border border-border-weak-base bg-background-panel p-1.5 shadow-2xl">
                <Show
                  when={!outlineLoading()}
                  fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().outlineLoading}</div>}
                >
                  <Show when={!outlineError()} fallback={<div class="px-3 py-2 text-12-regular text-text-danger">{label().outlineFailed}</div>}>
                    <Show when={symbols().length > 0} fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{label().outlineEmpty}</div>}>
                      <For each={symbols()}>
                        {(symbol) => (
                          <DropdownMenu.Item
                            class="rounded-lg"
                            onSelect={() => {
                              void handle().revealSelection(symbol.selection)
                            }}
                          >
                            <div
                              class="min-w-0 py-0.5"
                              style={{
                                "padding-left": `${Math.min(symbol.depth, 8) * 14}px`,
                              }}
                            >
                              <DropdownMenu.ItemLabel class="truncate text-12-medium text-text-primary">
                                {symbol.label}
                              </DropdownMenu.ItemLabel>
                              <Show when={symbol.detail}>
                                {(detail) => (
                                  <DropdownMenu.ItemDescription class="truncate text-11-regular text-text-weak">
                                    {detail()}
                                  </DropdownMenu.ItemDescription>
                                )}
                              </Show>
                            </div>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      )}
    </Show>
  )
}
