import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@lfcode-ai/ui/context"
import { MOTION_CHANGE_EVENT } from "@lfcode-ai/ui/motion-presence"
import { persisted } from "@/utils/persist"
import {
  filterBrowserBookmarks,
  removeBrowserBookmark,
  type BrowserBookmark,
  upsertBrowserBookmark,
} from "@/utils/browser-settings"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    restrictExternalDirectories: boolean
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    motionMode: MotionMode
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
    liquidGlass: {
      blur: number
      opacity: number
      highlight: number
      tint: number
      saturation: number
    }
  }
  editor: {
    fontSize: number
    lineHeight: number
    tabSize: number
    fontLigatures: boolean
    wordWrap: boolean
    minimap: boolean
    lineNumbers: boolean
    glyphMargin: boolean
    overviewRuler: boolean
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
    renderControlCharacters: boolean
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
    renderFinalNewline: boolean
    trimAutoWhitespace: boolean
    formatOnPaste: boolean
    formatOnType: boolean
    formatOnSave: boolean
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
  browser: {
    autofillEnabled: boolean
    promptToSavePasswords: boolean
    bookmarks: BrowserBookmark[]
  }
}

export type MotionMode = "full" | "standard" | "off"

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
export const liquidGlassDefaults = {
  blur: 24,
  opacity: 68,
  highlight: 76,
  tint: 44,
  saturation: 126,
} as const

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    restrictExternalDirectories: false,
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    motionMode: "full",
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
    liquidGlass: { ...liquidGlassDefaults },
  },
  editor: {
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    fontLigatures: false,
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
    glyphMargin: true,
    overviewRuler: true,
    currentLineHighlight: true,
    currentLineHighlightOnlyWhenFocus: false,
    cursorStyle: "line",
    cursorBlinking: "blink",
    cursorWidth: 2,
    cursorSurroundingLines: 2,
    cursorSurroundingLinesStyle: "default",
    multiCursorModifier: "alt",
    hover: true,
    selectionHighlight: true,
    occurrencesHighlight: true,
    linkedEditing: true,
    inlayHints: true,
    semanticHighlighting: true,
    codeLens: true,
    lightbulb: true,
    quickSuggestions: true,
    quickSuggestionsDelay: 10,
    inlineSuggestions: true,
    wordBasedSuggestions: true,
    parameterHints: true,
    suggestSelection: "recentlyUsedByPrefix",
    snippetSuggestions: "inline",
    acceptSuggestionOnEnter: "smart",
    acceptSuggestionOnCommitCharacter: true,
    tabCompletion: true,
    showUnused: true,
    showDeprecated: true,
    autoClosingBrackets: true,
    autoClosingQuotes: true,
    dragAndDrop: true,
    columnSelection: false,
    copyWithSyntaxHighlighting: true,
    matchBrackets: true,
    colorDecorators: true,
    renderValidationDecorations: "editable",
    unicodeHighlightAmbiguous: true,
    unicodeHighlightInvisible: true,
    renderControlCharacters: false,
    renderWhitespace: false,
    bracketPairGuides: true,
    bracketPairHorizontalGuides: true,
    highlightActiveBracketPair: true,
    bracketPairColorization: true,
    indentGuides: true,
    highlightActiveIndentation: true,
    folding: true,
    showFoldingControls: "mouseover",
    smoothScrolling: true,
    cursorAnimation: true,
    mouseWheelZoom: true,
    stickyScroll: true,
    scrollBeyondLastLine: true,
    rulers: [],
    renderFinalNewline: false,
    trimAutoWhitespace: true,
    formatOnPaste: false,
    formatOnType: false,
    formatOnSave: true,
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
  browser: {
    autofillEnabled: false,
    promptToSavePasswords: true,
    bookmarks: [],
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))
    const [reducedMotion, setReducedMotion] = createSignal(false)

    createEffect(() => {
      if (typeof document === "undefined" || typeof window === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    createEffect(() => {
      if (typeof window === "undefined") return
      const query = window.matchMedia("(prefers-reduced-motion: reduce)")
      const update = () => setReducedMotion(query.matches)
      update()
      query.addEventListener("change", update)
      onCleanup(() => query.removeEventListener("change", update))
    })

    createEffect(() => {
      if (typeof document === "undefined" || typeof window === "undefined") return
      const root = document.documentElement
      const mode = store.general?.motionMode
      root.dataset.motionMode = mode === "standard" || mode === "off" ? mode : "full"
      root.dataset.motionReduced = reducedMotion() ? "true" : "false"
      window.dispatchEvent(new Event(MOTION_CHANGE_EVENT))
    })

    createEffect(() => {
      if (store.general?.followup === "queue" || store.general?.followup === "steer") return
      setStore("general", "followup", defaultSettings.general.followup)
    })

    createEffect(() => {
      const value = store.general?.motionMode
      if (value === "full" || value === "standard" || value === "off") return
      setStore("general", "motionMode", defaultSettings.general.motionMode)
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: withFallback(() => store.general?.followup, defaultSettings.general.followup),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value)
        },
        restrictExternalDirectories: withFallback(
          () => store.general?.restrictExternalDirectories,
          defaultSettings.general.restrictExternalDirectories,
        ),
        setRestrictExternalDirectories(value: boolean) {
          setStore("general", "restrictExternalDirectories", value)
        },
        showFileTree: withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree),
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch: withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch),
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showStatus: withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus),
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        motionMode: withFallback(() => store.general?.motionMode, defaultSettings.general.motionMode),
        setMotionMode(value: MotionMode) {
          setStore("general", "motionMode", value)
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
        liquidGlass: {
          blur: withFallback(() => store.appearance?.liquidGlass?.blur, defaultSettings.appearance.liquidGlass.blur),
          opacity: withFallback(
            () => store.appearance?.liquidGlass?.opacity,
            defaultSettings.appearance.liquidGlass.opacity,
          ),
          highlight: withFallback(
            () => store.appearance?.liquidGlass?.highlight,
            defaultSettings.appearance.liquidGlass.highlight,
          ),
          tint: withFallback(() => store.appearance?.liquidGlass?.tint, defaultSettings.appearance.liquidGlass.tint),
          saturation: withFallback(
            () => store.appearance?.liquidGlass?.saturation,
            defaultSettings.appearance.liquidGlass.saturation,
          ),
          setBlur(value: number) {
            setStore("appearance", "liquidGlass", "blur", value)
          },
          setOpacity(value: number) {
            setStore("appearance", "liquidGlass", "opacity", value)
          },
          setHighlight(value: number) {
            setStore("appearance", "liquidGlass", "highlight", value)
          },
          setTint(value: number) {
            setStore("appearance", "liquidGlass", "tint", value)
          },
          setSaturation(value: number) {
            setStore("appearance", "liquidGlass", "saturation", value)
          },
          reset() {
            setStore("appearance", "liquidGlass", { ...defaultSettings.appearance.liquidGlass })
          },
        },
      },
      editor: {
        fontSize: withFallback(() => store.editor?.fontSize, defaultSettings.editor.fontSize),
        setFontSize(value: number) {
          setStore("editor", "fontSize", Math.max(11, Math.min(24, Math.round(value) || defaultSettings.editor.fontSize)))
        },
        lineHeight: withFallback(() => store.editor?.lineHeight, defaultSettings.editor.lineHeight),
        setLineHeight(value: number) {
          setStore("editor", "lineHeight", Math.max(16, Math.min(40, Math.round(value) || defaultSettings.editor.lineHeight)))
        },
        tabSize: withFallback(() => store.editor?.tabSize, defaultSettings.editor.tabSize),
        setTabSize(value: number) {
          setStore("editor", "tabSize", Math.max(2, Math.min(8, Math.round(value) || defaultSettings.editor.tabSize)))
        },
        fontLigatures: withFallback(() => store.editor?.fontLigatures, defaultSettings.editor.fontLigatures),
        setFontLigatures(value: boolean) {
          setStore("editor", "fontLigatures", value)
        },
        wordWrap: withFallback(() => store.editor?.wordWrap, defaultSettings.editor.wordWrap),
        setWordWrap(value: boolean) {
          setStore("editor", "wordWrap", value)
        },
        minimap: withFallback(() => store.editor?.minimap, defaultSettings.editor.minimap),
        setMinimap(value: boolean) {
          setStore("editor", "minimap", value)
        },
        lineNumbers: withFallback(() => store.editor?.lineNumbers, defaultSettings.editor.lineNumbers),
        setLineNumbers(value: boolean) {
          setStore("editor", "lineNumbers", value)
        },
        glyphMargin: withFallback(() => store.editor?.glyphMargin, defaultSettings.editor.glyphMargin),
        setGlyphMargin(value: boolean) {
          setStore("editor", "glyphMargin", value)
        },
        overviewRuler: withFallback(() => store.editor?.overviewRuler, defaultSettings.editor.overviewRuler),
        setOverviewRuler(value: boolean) {
          setStore("editor", "overviewRuler", value)
        },
        currentLineHighlight: withFallback(
          () => store.editor?.currentLineHighlight,
          defaultSettings.editor.currentLineHighlight,
        ),
        setCurrentLineHighlight(value: boolean) {
          setStore("editor", "currentLineHighlight", value)
        },
        currentLineHighlightOnlyWhenFocus: withFallback(
          () => store.editor?.currentLineHighlightOnlyWhenFocus,
          defaultSettings.editor.currentLineHighlightOnlyWhenFocus,
        ),
        setCurrentLineHighlightOnlyWhenFocus(value: boolean) {
          setStore("editor", "currentLineHighlightOnlyWhenFocus", value)
        },
        cursorStyle: withFallback(() => store.editor?.cursorStyle, defaultSettings.editor.cursorStyle),
        setCursorStyle(value: "line" | "line-thin" | "block" | "block-outline" | "underline" | "underline-thin") {
          setStore("editor", "cursorStyle", value)
        },
        cursorBlinking: withFallback(() => store.editor?.cursorBlinking, defaultSettings.editor.cursorBlinking),
        setCursorBlinking(value: "blink" | "smooth" | "phase" | "expand" | "solid") {
          setStore("editor", "cursorBlinking", value)
        },
        cursorWidth: withFallback(() => store.editor?.cursorWidth, defaultSettings.editor.cursorWidth),
        setCursorWidth(value: number) {
          setStore("editor", "cursorWidth", Math.max(1, Math.min(6, Math.round(value) || defaultSettings.editor.cursorWidth)))
        },
        cursorSurroundingLines: withFallback(
          () => store.editor?.cursorSurroundingLines,
          defaultSettings.editor.cursorSurroundingLines,
        ),
        setCursorSurroundingLines(value: number) {
          setStore(
            "editor",
            "cursorSurroundingLines",
            Math.max(0, Math.min(12, Math.round(value) || defaultSettings.editor.cursorSurroundingLines)),
          )
        },
        cursorSurroundingLinesStyle: withFallback(
          () => store.editor?.cursorSurroundingLinesStyle,
          defaultSettings.editor.cursorSurroundingLinesStyle,
        ),
        setCursorSurroundingLinesStyle(value: "default" | "all") {
          setStore("editor", "cursorSurroundingLinesStyle", value)
        },
        multiCursorModifier: withFallback(
          () => store.editor?.multiCursorModifier,
          defaultSettings.editor.multiCursorModifier,
        ),
        setMultiCursorModifier(value: "alt" | "ctrlCmd") {
          setStore("editor", "multiCursorModifier", value)
        },
        hover: withFallback(() => store.editor?.hover, defaultSettings.editor.hover),
        setHover(value: boolean) {
          setStore("editor", "hover", value)
        },
        selectionHighlight: withFallback(
          () => store.editor?.selectionHighlight,
          defaultSettings.editor.selectionHighlight,
        ),
        setSelectionHighlight(value: boolean) {
          setStore("editor", "selectionHighlight", value)
        },
        occurrencesHighlight: withFallback(
          () => store.editor?.occurrencesHighlight,
          defaultSettings.editor.occurrencesHighlight,
        ),
        setOccurrencesHighlight(value: boolean) {
          setStore("editor", "occurrencesHighlight", value)
        },
        linkedEditing: withFallback(() => store.editor?.linkedEditing, defaultSettings.editor.linkedEditing),
        setLinkedEditing(value: boolean) {
          setStore("editor", "linkedEditing", value)
        },
        inlayHints: withFallback(() => store.editor?.inlayHints, defaultSettings.editor.inlayHints),
        setInlayHints(value: boolean) {
          setStore("editor", "inlayHints", value)
        },
        semanticHighlighting: withFallback(
          () => store.editor?.semanticHighlighting,
          defaultSettings.editor.semanticHighlighting,
        ),
        setSemanticHighlighting(value: boolean) {
          setStore("editor", "semanticHighlighting", value)
        },
        codeLens: withFallback(() => store.editor?.codeLens, defaultSettings.editor.codeLens),
        setCodeLens(value: boolean) {
          setStore("editor", "codeLens", value)
        },
        lightbulb: withFallback(() => store.editor?.lightbulb, defaultSettings.editor.lightbulb),
        setLightbulb(value: boolean) {
          setStore("editor", "lightbulb", value)
        },
        quickSuggestions: withFallback(
          () => store.editor?.quickSuggestions,
          defaultSettings.editor.quickSuggestions,
        ),
        setQuickSuggestions(value: boolean) {
          setStore("editor", "quickSuggestions", value)
        },
        quickSuggestionsDelay: withFallback(
          () => store.editor?.quickSuggestionsDelay,
          defaultSettings.editor.quickSuggestionsDelay,
        ),
        setQuickSuggestionsDelay(value: number) {
          setStore(
            "editor",
            "quickSuggestionsDelay",
            Math.max(0, Math.min(1000, Math.round(value) || defaultSettings.editor.quickSuggestionsDelay)),
          )
        },
        inlineSuggestions: withFallback(
          () => store.editor?.inlineSuggestions,
          defaultSettings.editor.inlineSuggestions,
        ),
        setInlineSuggestions(value: boolean) {
          setStore("editor", "inlineSuggestions", value)
        },
        wordBasedSuggestions: withFallback(
          () => store.editor?.wordBasedSuggestions,
          defaultSettings.editor.wordBasedSuggestions,
        ),
        setWordBasedSuggestions(value: boolean) {
          setStore("editor", "wordBasedSuggestions", value)
        },
        parameterHints: withFallback(() => store.editor?.parameterHints, defaultSettings.editor.parameterHints),
        setParameterHints(value: boolean) {
          setStore("editor", "parameterHints", value)
        },
        suggestSelection: withFallback(
          () => store.editor?.suggestSelection,
          defaultSettings.editor.suggestSelection,
        ),
        setSuggestSelection(value: "first" | "recentlyUsed" | "recentlyUsedByPrefix") {
          setStore("editor", "suggestSelection", value)
        },
        snippetSuggestions: withFallback(
          () => store.editor?.snippetSuggestions,
          defaultSettings.editor.snippetSuggestions,
        ),
        setSnippetSuggestions(value: "top" | "bottom" | "inline" | "none") {
          setStore("editor", "snippetSuggestions", value)
        },
        acceptSuggestionOnEnter: withFallback(
          () => store.editor?.acceptSuggestionOnEnter,
          defaultSettings.editor.acceptSuggestionOnEnter,
        ),
        setAcceptSuggestionOnEnter(value: "smart" | "on" | "off") {
          setStore("editor", "acceptSuggestionOnEnter", value)
        },
        acceptSuggestionOnCommitCharacter: withFallback(
          () => store.editor?.acceptSuggestionOnCommitCharacter,
          defaultSettings.editor.acceptSuggestionOnCommitCharacter,
        ),
        setAcceptSuggestionOnCommitCharacter(value: boolean) {
          setStore("editor", "acceptSuggestionOnCommitCharacter", value)
        },
        tabCompletion: withFallback(() => store.editor?.tabCompletion, defaultSettings.editor.tabCompletion),
        setTabCompletion(value: boolean) {
          setStore("editor", "tabCompletion", value)
        },
        showUnused: withFallback(() => store.editor?.showUnused, defaultSettings.editor.showUnused),
        setShowUnused(value: boolean) {
          setStore("editor", "showUnused", value)
        },
        showDeprecated: withFallback(() => store.editor?.showDeprecated, defaultSettings.editor.showDeprecated),
        setShowDeprecated(value: boolean) {
          setStore("editor", "showDeprecated", value)
        },
        autoClosingBrackets: withFallback(
          () => store.editor?.autoClosingBrackets,
          defaultSettings.editor.autoClosingBrackets,
        ),
        setAutoClosingBrackets(value: boolean) {
          setStore("editor", "autoClosingBrackets", value)
        },
        autoClosingQuotes: withFallback(
          () => store.editor?.autoClosingQuotes,
          defaultSettings.editor.autoClosingQuotes,
        ),
        setAutoClosingQuotes(value: boolean) {
          setStore("editor", "autoClosingQuotes", value)
        },
        dragAndDrop: withFallback(() => store.editor?.dragAndDrop, defaultSettings.editor.dragAndDrop),
        setDragAndDrop(value: boolean) {
          setStore("editor", "dragAndDrop", value)
        },
        columnSelection: withFallback(() => store.editor?.columnSelection, defaultSettings.editor.columnSelection),
        setColumnSelection(value: boolean) {
          setStore("editor", "columnSelection", value)
        },
        copyWithSyntaxHighlighting: withFallback(
          () => store.editor?.copyWithSyntaxHighlighting,
          defaultSettings.editor.copyWithSyntaxHighlighting,
        ),
        setCopyWithSyntaxHighlighting(value: boolean) {
          setStore("editor", "copyWithSyntaxHighlighting", value)
        },
        matchBrackets: withFallback(() => store.editor?.matchBrackets, defaultSettings.editor.matchBrackets),
        setMatchBrackets(value: boolean) {
          setStore("editor", "matchBrackets", value)
        },
        colorDecorators: withFallback(() => store.editor?.colorDecorators, defaultSettings.editor.colorDecorators),
        setColorDecorators(value: boolean) {
          setStore("editor", "colorDecorators", value)
        },
        renderValidationDecorations: withFallback(
          () => store.editor?.renderValidationDecorations,
          defaultSettings.editor.renderValidationDecorations,
        ),
        setRenderValidationDecorations(value: "editable" | "on" | "off") {
          setStore("editor", "renderValidationDecorations", value)
        },
        unicodeHighlightAmbiguous: withFallback(
          () => store.editor?.unicodeHighlightAmbiguous,
          defaultSettings.editor.unicodeHighlightAmbiguous,
        ),
        setUnicodeHighlightAmbiguous(value: boolean) {
          setStore("editor", "unicodeHighlightAmbiguous", value)
        },
        unicodeHighlightInvisible: withFallback(
          () => store.editor?.unicodeHighlightInvisible,
          defaultSettings.editor.unicodeHighlightInvisible,
        ),
        setUnicodeHighlightInvisible(value: boolean) {
          setStore("editor", "unicodeHighlightInvisible", value)
        },
        renderControlCharacters: withFallback(
          () => store.editor?.renderControlCharacters,
          defaultSettings.editor.renderControlCharacters,
        ),
        setRenderControlCharacters(value: boolean) {
          setStore("editor", "renderControlCharacters", value)
        },
        renderWhitespace: withFallback(
          () => store.editor?.renderWhitespace,
          defaultSettings.editor.renderWhitespace,
        ),
        setRenderWhitespace(value: boolean) {
          setStore("editor", "renderWhitespace", value)
        },
        bracketPairGuides: withFallback(
          () => store.editor?.bracketPairGuides,
          defaultSettings.editor.bracketPairGuides,
        ),
        setBracketPairGuides(value: boolean) {
          setStore("editor", "bracketPairGuides", value)
        },
        bracketPairHorizontalGuides: withFallback(
          () => store.editor?.bracketPairHorizontalGuides,
          defaultSettings.editor.bracketPairHorizontalGuides,
        ),
        setBracketPairHorizontalGuides(value: boolean) {
          setStore("editor", "bracketPairHorizontalGuides", value)
        },
        highlightActiveBracketPair: withFallback(
          () => store.editor?.highlightActiveBracketPair,
          defaultSettings.editor.highlightActiveBracketPair,
        ),
        setHighlightActiveBracketPair(value: boolean) {
          setStore("editor", "highlightActiveBracketPair", value)
        },
        bracketPairColorization: withFallback(
          () => store.editor?.bracketPairColorization,
          defaultSettings.editor.bracketPairColorization,
        ),
        setBracketPairColorization(value: boolean) {
          setStore("editor", "bracketPairColorization", value)
        },
        indentGuides: withFallback(() => store.editor?.indentGuides, defaultSettings.editor.indentGuides),
        setIndentGuides(value: boolean) {
          setStore("editor", "indentGuides", value)
        },
        highlightActiveIndentation: withFallback(
          () => store.editor?.highlightActiveIndentation,
          defaultSettings.editor.highlightActiveIndentation,
        ),
        setHighlightActiveIndentation(value: boolean) {
          setStore("editor", "highlightActiveIndentation", value)
        },
        folding: withFallback(() => store.editor?.folding, defaultSettings.editor.folding),
        setFolding(value: boolean) {
          setStore("editor", "folding", value)
        },
        showFoldingControls: withFallback(
          () => store.editor?.showFoldingControls,
          defaultSettings.editor.showFoldingControls,
        ),
        setShowFoldingControls(value: "mouseover" | "always" | "never") {
          setStore("editor", "showFoldingControls", value)
        },
        smoothScrolling: withFallback(() => store.editor?.smoothScrolling, defaultSettings.editor.smoothScrolling),
        setSmoothScrolling(value: boolean) {
          setStore("editor", "smoothScrolling", value)
        },
        cursorAnimation: withFallback(() => store.editor?.cursorAnimation, defaultSettings.editor.cursorAnimation),
        setCursorAnimation(value: boolean) {
          setStore("editor", "cursorAnimation", value)
        },
        mouseWheelZoom: withFallback(() => store.editor?.mouseWheelZoom, defaultSettings.editor.mouseWheelZoom),
        setMouseWheelZoom(value: boolean) {
          setStore("editor", "mouseWheelZoom", value)
        },
        stickyScroll: withFallback(() => store.editor?.stickyScroll, defaultSettings.editor.stickyScroll),
        setStickyScroll(value: boolean) {
          setStore("editor", "stickyScroll", value)
        },
        scrollBeyondLastLine: withFallback(
          () => store.editor?.scrollBeyondLastLine,
          defaultSettings.editor.scrollBeyondLastLine,
        ),
        setScrollBeyondLastLine(value: boolean) {
          setStore("editor", "scrollBeyondLastLine", value)
        },
        rulers: withFallback(() => store.editor?.rulers, defaultSettings.editor.rulers),
        setRulers(value: number[]) {
          setStore(
            "editor",
            "rulers",
            value
              .filter((item) => Number.isInteger(item) && item >= 40 && item <= 240)
              .slice(0, 4),
          )
        },
        renderFinalNewline: withFallback(
          () => store.editor?.renderFinalNewline,
          defaultSettings.editor.renderFinalNewline,
        ),
        setRenderFinalNewline(value: boolean) {
          setStore("editor", "renderFinalNewline", value)
        },
        trimAutoWhitespace: withFallback(
          () => store.editor?.trimAutoWhitespace,
          defaultSettings.editor.trimAutoWhitespace,
        ),
        setTrimAutoWhitespace(value: boolean) {
          setStore("editor", "trimAutoWhitespace", value)
        },
        formatOnPaste: withFallback(() => store.editor?.formatOnPaste, defaultSettings.editor.formatOnPaste),
        setFormatOnPaste(value: boolean) {
          setStore("editor", "formatOnPaste", value)
        },
        formatOnType: withFallback(() => store.editor?.formatOnType, defaultSettings.editor.formatOnType),
        setFormatOnType(value: boolean) {
          setStore("editor", "formatOnType", value)
        },
        formatOnSave: withFallback(() => store.editor?.formatOnSave, defaultSettings.editor.formatOnSave),
        setFormatOnSave(value: boolean) {
          setStore("editor", "formatOnSave", value)
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
      browser: {
        autofillEnabled: withFallback(
          () => store.browser?.autofillEnabled,
          defaultSettings.browser.autofillEnabled,
        ),
        setAutofillEnabled(value: boolean) {
          setStore("browser", "autofillEnabled", value)
        },
        promptToSavePasswords: withFallback(
          () => store.browser?.promptToSavePasswords,
          defaultSettings.browser.promptToSavePasswords,
        ),
        setPromptToSavePasswords(value: boolean) {
          setStore("browser", "promptToSavePasswords", value)
        },
        bookmarks: createMemo(() => filterBrowserBookmarks(store.browser?.bookmarks ?? defaultSettings.browser.bookmarks, "")),
        upsertBookmark(input: {
          id: string
          title: string
          url: string
        }) {
          setStore("browser", "bookmarks", (current) => {
            return (
              upsertBrowserBookmark(current ?? [], {
                ...input,
                now: Date.now(),
              }) ?? current ?? []
            )
          })
        },
        removeBookmark(id: string) {
          setStore("browser", "bookmarks", (current) => removeBrowserBookmark(current ?? [], id))
        },
      },
    }
  },
})
