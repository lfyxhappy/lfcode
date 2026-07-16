import { type Component, createMemo, createResource, For, Show } from "solid-js"
import { Select } from "@lfcode-ai/ui/select"
import { Switch } from "@lfcode-ai/ui/switch"
import { SettingsList } from "./settings-list"
import { SettingsPageShell, SettingsRow, SettingsSection } from "./settings-page-shell"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { isCodeEditorPhase0Enabled, setCodeEditorPhase0Enabled } from "@/components/code-editor/core/phase0"

export const SettingsEditor: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const settings = useSettings()
  const globalSDK = useGlobalSDK()
  const [lspStatuses] = createResource(
    () => props.directory,
    (directory) =>
      globalSDK
        .createClient({ directory, throwOnError: true })
        .lsp.status()
        .then((result) => result.data ?? []),
  )

  const editorFontSizeOptions = createMemo(() =>
    Array.from({ length: 14 }, (_, index) => {
      const value = index + 11
      return { value, label: `${value}px` }
    }),
  )

  const editorLineHeightOptions = createMemo(() =>
    [18, 20, 22, 24, 28, 32].map((value) => ({
      value,
      label: `${value}px`,
    })),
  )

  const editorTabSizeOptions = createMemo(() =>
    [2, 4, 6, 8].map((value) => ({
      value,
      label: String(value),
    })),
  )

  const quickSuggestionsDelayOptions = createMemo(() =>
    [0, 10, 50, 100, 250, 500].map((value) => ({
      value,
      label: `${value}ms`,
    })),
  )

  const cursorStyleOptions = createMemo(() => [
    { value: "line" as const, label: language.t("settings.general.row.editorCursorStyle.option.line") },
    { value: "line-thin" as const, label: language.t("settings.general.row.editorCursorStyle.option.lineThin") },
    { value: "block" as const, label: language.t("settings.general.row.editorCursorStyle.option.block") },
    {
      value: "block-outline" as const,
      label: language.t("settings.general.row.editorCursorStyle.option.blockOutline"),
    },
    { value: "underline" as const, label: language.t("settings.general.row.editorCursorStyle.option.underline") },
    {
      value: "underline-thin" as const,
      label: language.t("settings.general.row.editorCursorStyle.option.underlineThin"),
    },
  ])

  const cursorBlinkingOptions = createMemo(() => [
    { value: "blink" as const, label: language.t("settings.general.row.editorCursorBlinking.option.blink") },
    { value: "smooth" as const, label: language.t("settings.general.row.editorCursorBlinking.option.smooth") },
    { value: "phase" as const, label: language.t("settings.general.row.editorCursorBlinking.option.phase") },
    { value: "expand" as const, label: language.t("settings.general.row.editorCursorBlinking.option.expand") },
    { value: "solid" as const, label: language.t("settings.general.row.editorCursorBlinking.option.solid") },
  ])

  const cursorWidthOptions = createMemo(() =>
    [1, 2, 3, 4, 5, 6].map((value) => ({
      value,
      label: `${value}px`,
    })),
  )

  const cursorSurroundingLinesOptions = createMemo(() =>
    [0, 1, 2, 3, 5, 8].map((value) => ({
      value,
      label: value === 0 ? language.t("settings.general.row.editorCursorSurroundingLines.option.off") : `${value}`,
    })),
  )

  const cursorSurroundingLinesStyleOptions = createMemo(() => [
    {
      value: "default" as const,
      label: language.t("settings.general.row.editorCursorSurroundingLinesStyle.option.default"),
    },
    {
      value: "all" as const,
      label: language.t("settings.general.row.editorCursorSurroundingLinesStyle.option.all"),
    },
  ])

  const multiCursorModifierOptions = createMemo(() => [
    { value: "alt" as const, label: language.t("settings.general.row.editorMultiCursorModifier.option.alt") },
    { value: "ctrlCmd" as const, label: language.t("settings.general.row.editorMultiCursorModifier.option.ctrlCmd") },
  ])

  const acceptSuggestionOnEnterOptions = createMemo(() => [
    { value: "smart" as const, label: language.t("settings.general.row.editorAcceptSuggestionOnEnter.option.smart") },
    { value: "on" as const, label: language.t("settings.general.row.editorAcceptSuggestionOnEnter.option.on") },
    { value: "off" as const, label: language.t("settings.general.row.editorAcceptSuggestionOnEnter.option.off") },
  ])

  const suggestSelectionOptions = createMemo(() => [
    { value: "first" as const, label: language.t("settings.general.row.editorSuggestSelection.option.first") },
    {
      value: "recentlyUsed" as const,
      label: language.t("settings.general.row.editorSuggestSelection.option.recentlyUsed"),
    },
    {
      value: "recentlyUsedByPrefix" as const,
      label: language.t("settings.general.row.editorSuggestSelection.option.recentlyUsedByPrefix"),
    },
  ])

  const snippetSuggestionOptions = createMemo(() => [
    { value: "top" as const, label: language.t("settings.general.row.editorSnippetSuggestions.option.top") },
    { value: "bottom" as const, label: language.t("settings.general.row.editorSnippetSuggestions.option.bottom") },
    { value: "inline" as const, label: language.t("settings.general.row.editorSnippetSuggestions.option.inline") },
    { value: "none" as const, label: language.t("settings.general.row.editorSnippetSuggestions.option.none") },
  ])

  const rulerOptions = createMemo(() => [
    { key: "off", value: [] as number[], label: language.t("settings.general.row.editorRulers.option.off") },
    { key: "80", value: [80], label: language.t("settings.general.row.editorRulers.option.80") },
    { key: "100", value: [100], label: language.t("settings.general.row.editorRulers.option.100") },
    { key: "120", value: [120], label: language.t("settings.general.row.editorRulers.option.120") },
    { key: "80,120", value: [80, 120], label: language.t("settings.general.row.editorRulers.option.80and120") },
  ])

  const renderValidationDecorationOptions = createMemo(() => [
    {
      value: "editable" as const,
      label: language.t("settings.general.row.editorRenderValidationDecorations.option.editable"),
    },
    {
      value: "on" as const,
      label: language.t("settings.general.row.editorRenderValidationDecorations.option.on"),
    },
    {
      value: "off" as const,
      label: language.t("settings.general.row.editorRenderValidationDecorations.option.off"),
    },
  ])

  const showFoldingControlsOptions = createMemo(() => [
    {
      value: "mouseover" as const,
      label: language.t("settings.general.row.editorShowFoldingControls.option.mouseover"),
    },
    {
      value: "always" as const,
      label: language.t("settings.general.row.editorShowFoldingControls.option.always"),
    },
    {
      value: "never" as const,
      label: language.t("settings.general.row.editorShowFoldingControls.option.never"),
    },
  ])

  return (
    <SettingsPageShell title={language.t("settings.tab.editor")}>
      <SettingsSection title={language.t("settings.editor.intellisense.title")}>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.editor.intellisense.local.title")}
            description={language.t("settings.editor.intellisense.local.description")}
          >
            <span class="text-12-regular text-text-weak">TypeScript · JavaScript · JSON</span>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.editor.intellisense.server.title")}
            description={language.t("settings.editor.intellisense.server.description")}
          >
            <div class="flex max-w-72 flex-wrap justify-end gap-1.5 text-12-regular">
              <Show
                when={!lspStatuses.loading}
                fallback={<span class="text-text-weak">{language.t("common.loading")}</span>}
              >
                <Show
                  when={(lspStatuses.latest ?? []).length > 0}
                  fallback={
                    <span class="text-text-weak">{language.t("settings.editor.intellisense.server.empty")}</span>
                  }
                >
                  <For each={lspStatuses.latest ?? []}>
                    {(item) => (
                      <span
                        classList={{
                          "rounded-full px-2 py-0.5": true,
                          "bg-status-success/15 text-status-success": item.status === "connected",
                          "bg-status-error/15 text-status-error": item.status === "error",
                        }}
                      >
                        {item.name || item.id}
                      </span>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.editor.intellisense.snippets.title")}
            description={language.t("settings.editor.intellisense.snippets.description")}
          >
            <span class="text-right text-12-regular text-text-weak">
              ~/.lfcode/snippets
              <br />
              .lfcode/snippets
            </span>
          </SettingsRow>
        </SettingsList>
      </SettingsSection>
      <SettingsSection title={language.t("settings.general.section.editor")}>
        <SettingsList>
          <SettingsRow
            title={language.t("settings.general.row.editorFontSize.title")}
            description={language.t("settings.general.row.editorFontSize.description")}
          >
            <Select
              data-action="settings-editor-font-size"
              options={editorFontSizeOptions()}
              current={editorFontSizeOptions().find((option) => option.value === settings.editor.fontSize())}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setFontSize(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorLineHeight.title")}
            description={language.t("settings.general.row.editorLineHeight.description")}
          >
            <Select
              data-action="settings-editor-line-height"
              options={editorLineHeightOptions()}
              current={editorLineHeightOptions().find((option) => option.value === settings.editor.lineHeight())}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setLineHeight(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorTabSize.title")}
            description={language.t("settings.general.row.editorTabSize.description")}
          >
            <Select
              data-action="settings-editor-tab-size"
              options={editorTabSizeOptions()}
              current={editorTabSizeOptions().find((option) => option.value === settings.editor.tabSize())}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setTabSize(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorFontLigatures.title")}
            description={language.t("settings.general.row.editorFontLigatures.description")}
          >
            <div data-action="settings-editor-font-ligatures">
              <Switch
                checked={settings.editor.fontLigatures()}
                onChange={(checked) => settings.editor.setFontLigatures(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorWordWrap.title")}
            description={language.t("settings.general.row.editorWordWrap.description")}
          >
            <div data-action="settings-editor-word-wrap">
              <Switch
                checked={settings.editor.wordWrap()}
                onChange={(checked) => settings.editor.setWordWrap(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorMinimap.title")}
            description={language.t("settings.general.row.editorMinimap.description")}
          >
            <div data-action="settings-editor-minimap">
              <Switch checked={settings.editor.minimap()} onChange={(checked) => settings.editor.setMinimap(checked)} />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorLineNumbers.title")}
            description={language.t("settings.general.row.editorLineNumbers.description")}
          >
            <div data-action="settings-editor-line-numbers">
              <Switch
                checked={settings.editor.lineNumbers()}
                onChange={(checked) => settings.editor.setLineNumbers(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorGlyphMargin.title")}
            description={language.t("settings.general.row.editorGlyphMargin.description")}
          >
            <div data-action="settings-editor-glyph-margin">
              <Switch
                checked={settings.editor.glyphMargin()}
                onChange={(checked) => settings.editor.setGlyphMargin(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorOverviewRuler.title")}
            description={language.t("settings.general.row.editorOverviewRuler.description")}
          >
            <div data-action="settings-editor-overview-ruler">
              <Switch
                checked={settings.editor.overviewRuler()}
                onChange={(checked) => settings.editor.setOverviewRuler(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCurrentLineHighlight.title")}
            description={language.t("settings.general.row.editorCurrentLineHighlight.description")}
          >
            <div data-action="settings-editor-current-line-highlight">
              <Switch
                checked={settings.editor.currentLineHighlight()}
                onChange={(checked) => settings.editor.setCurrentLineHighlight(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCurrentLineHighlightOnlyWhenFocus.title")}
            description={language.t("settings.general.row.editorCurrentLineHighlightOnlyWhenFocus.description")}
          >
            <div data-action="settings-editor-current-line-highlight-only-when-focus">
              <Switch
                checked={settings.editor.currentLineHighlightOnlyWhenFocus()}
                onChange={(checked) => settings.editor.setCurrentLineHighlightOnlyWhenFocus(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorStyle.title")}
            description={language.t("settings.general.row.editorCursorStyle.description")}
          >
            <Select
              data-action="settings-editor-cursor-style"
              options={cursorStyleOptions()}
              current={cursorStyleOptions().find((option) => option.value === settings.editor.cursorStyle())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setCursorStyle(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorBlinking.title")}
            description={language.t("settings.general.row.editorCursorBlinking.description")}
          >
            <Select
              data-action="settings-editor-cursor-blinking"
              options={cursorBlinkingOptions()}
              current={cursorBlinkingOptions().find((option) => option.value === settings.editor.cursorBlinking())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setCursorBlinking(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorWidth.title")}
            description={language.t("settings.general.row.editorCursorWidth.description")}
          >
            <Select
              data-action="settings-editor-cursor-width"
              options={cursorWidthOptions()}
              current={cursorWidthOptions().find((option) => option.value === settings.editor.cursorWidth())}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setCursorWidth(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorSurroundingLines.title")}
            description={language.t("settings.general.row.editorCursorSurroundingLines.description")}
          >
            <Select
              data-action="settings-editor-cursor-surrounding-lines"
              options={cursorSurroundingLinesOptions()}
              current={cursorSurroundingLinesOptions().find(
                (option) => option.value === settings.editor.cursorSurroundingLines(),
              )}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setCursorSurroundingLines(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorSurroundingLinesStyle.title")}
            description={language.t("settings.general.row.editorCursorSurroundingLinesStyle.description")}
          >
            <Select
              data-action="settings-editor-cursor-surrounding-lines-style"
              options={cursorSurroundingLinesStyleOptions()}
              current={cursorSurroundingLinesStyleOptions().find(
                (option) => option.value === settings.editor.cursorSurroundingLinesStyle(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setCursorSurroundingLinesStyle(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorMultiCursorModifier.title")}
            description={language.t("settings.general.row.editorMultiCursorModifier.description")}
          >
            <Select
              data-action="settings-editor-multi-cursor-modifier"
              options={multiCursorModifierOptions()}
              current={multiCursorModifierOptions().find(
                (option) => option.value === settings.editor.multiCursorModifier(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setMultiCursorModifier(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorHover.title")}
            description={language.t("settings.general.row.editorHover.description")}
          >
            <div data-action="settings-editor-hover">
              <Switch checked={settings.editor.hover()} onChange={(checked) => settings.editor.setHover(checked)} />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorSelectionHighlight.title")}
            description={language.t("settings.general.row.editorSelectionHighlight.description")}
          >
            <div data-action="settings-editor-selection-highlight">
              <Switch
                checked={settings.editor.selectionHighlight()}
                onChange={(checked) => settings.editor.setSelectionHighlight(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorOccurrencesHighlight.title")}
            description={language.t("settings.general.row.editorOccurrencesHighlight.description")}
          >
            <div data-action="settings-editor-occurrences-highlight">
              <Switch
                checked={settings.editor.occurrencesHighlight()}
                onChange={(checked) => settings.editor.setOccurrencesHighlight(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorLinkedEditing.title")}
            description={language.t("settings.general.row.editorLinkedEditing.description")}
          >
            <div data-action="settings-editor-linked-editing">
              <Switch
                checked={settings.editor.linkedEditing()}
                onChange={(checked) => settings.editor.setLinkedEditing(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorInlayHints.title")}
            description={language.t("settings.general.row.editorInlayHints.description")}
          >
            <div data-action="settings-editor-inlay-hints">
              <Switch
                checked={settings.editor.inlayHints()}
                onChange={(checked) => settings.editor.setInlayHints(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorSemanticHighlighting.title")}
            description={language.t("settings.general.row.editorSemanticHighlighting.description")}
          >
            <div data-action="settings-editor-semantic-highlighting">
              <Switch
                checked={settings.editor.semanticHighlighting()}
                onChange={(checked) => settings.editor.setSemanticHighlighting(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCodeLens.title")}
            description={language.t("settings.general.row.editorCodeLens.description")}
          >
            <div data-action="settings-editor-code-lens">
              <Switch
                checked={settings.editor.codeLens()}
                onChange={(checked) => settings.editor.setCodeLens(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorLightbulb.title")}
            description={language.t("settings.general.row.editorLightbulb.description")}
          >
            <div data-action="settings-editor-lightbulb">
              <Switch
                checked={settings.editor.lightbulb()}
                onChange={(checked) => settings.editor.setLightbulb(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorQuickSuggestions.title")}
            description={language.t("settings.general.row.editorQuickSuggestions.description")}
          >
            <div data-action="settings-editor-quick-suggestions">
              <Switch
                checked={settings.editor.quickSuggestions()}
                onChange={(checked) => settings.editor.setQuickSuggestions(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorQuickSuggestionsDelay.title")}
            description={language.t("settings.general.row.editorQuickSuggestionsDelay.description")}
          >
            <Select
              data-action="settings-editor-quick-suggestions-delay"
              options={quickSuggestionsDelayOptions()}
              current={quickSuggestionsDelayOptions().find(
                (option) => option.value === settings.editor.quickSuggestionsDelay(),
              )}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setQuickSuggestionsDelay(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorInlineSuggestions.title")}
            description={language.t("settings.general.row.editorInlineSuggestions.description")}
          >
            <div data-action="settings-editor-inline-suggestions">
              <Switch
                checked={settings.editor.inlineSuggestions()}
                onChange={(checked) => settings.editor.setInlineSuggestions(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorWordBasedSuggestions.title")}
            description={language.t("settings.general.row.editorWordBasedSuggestions.description")}
          >
            <div data-action="settings-editor-word-based-suggestions">
              <Switch
                checked={settings.editor.wordBasedSuggestions()}
                onChange={(checked) => settings.editor.setWordBasedSuggestions(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorParameterHints.title")}
            description={language.t("settings.general.row.editorParameterHints.description")}
          >
            <div data-action="settings-editor-parameter-hints">
              <Switch
                checked={settings.editor.parameterHints()}
                onChange={(checked) => settings.editor.setParameterHints(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorSuggestSelection.title")}
            description={language.t("settings.general.row.editorSuggestSelection.description")}
          >
            <Select
              data-action="settings-editor-suggest-selection"
              options={suggestSelectionOptions()}
              current={suggestSelectionOptions().find((option) => option.value === settings.editor.suggestSelection())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setSuggestSelection(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorSnippetSuggestions.title")}
            description={language.t("settings.general.row.editorSnippetSuggestions.description")}
          >
            <Select
              data-action="settings-editor-snippet-suggestions"
              options={snippetSuggestionOptions()}
              current={snippetSuggestionOptions().find(
                (option) => option.value === settings.editor.snippetSuggestions(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setSnippetSuggestions(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorAcceptSuggestionOnEnter.title")}
            description={language.t("settings.general.row.editorAcceptSuggestionOnEnter.description")}
          >
            <Select
              data-action="settings-editor-accept-suggestion-on-enter"
              options={acceptSuggestionOnEnterOptions()}
              current={acceptSuggestionOnEnterOptions().find(
                (option) => option.value === settings.editor.acceptSuggestionOnEnter(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setAcceptSuggestionOnEnter(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorAcceptSuggestionOnCommitCharacter.title")}
            description={language.t("settings.general.row.editorAcceptSuggestionOnCommitCharacter.description")}
          >
            <div data-action="settings-editor-accept-suggestion-on-commit-character">
              <Switch
                checked={settings.editor.acceptSuggestionOnCommitCharacter()}
                onChange={(checked) => settings.editor.setAcceptSuggestionOnCommitCharacter(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorTabCompletion.title")}
            description={language.t("settings.general.row.editorTabCompletion.description")}
          >
            <div data-action="settings-editor-tab-completion">
              <Switch
                checked={settings.editor.tabCompletion()}
                onChange={(checked) => settings.editor.setTabCompletion(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorShowUnused.title")}
            description={language.t("settings.general.row.editorShowUnused.description")}
          >
            <div data-action="settings-editor-show-unused">
              <Switch
                checked={settings.editor.showUnused()}
                onChange={(checked) => settings.editor.setShowUnused(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorShowDeprecated.title")}
            description={language.t("settings.general.row.editorShowDeprecated.description")}
          >
            <div data-action="settings-editor-show-deprecated">
              <Switch
                checked={settings.editor.showDeprecated()}
                onChange={(checked) => settings.editor.setShowDeprecated(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorAutoClosingBrackets.title")}
            description={language.t("settings.general.row.editorAutoClosingBrackets.description")}
          >
            <div data-action="settings-editor-auto-closing-brackets">
              <Switch
                checked={settings.editor.autoClosingBrackets()}
                onChange={(checked) => settings.editor.setAutoClosingBrackets(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorAutoClosingQuotes.title")}
            description={language.t("settings.general.row.editorAutoClosingQuotes.description")}
          >
            <div data-action="settings-editor-auto-closing-quotes">
              <Switch
                checked={settings.editor.autoClosingQuotes()}
                onChange={(checked) => settings.editor.setAutoClosingQuotes(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorDragAndDrop.title")}
            description={language.t("settings.general.row.editorDragAndDrop.description")}
          >
            <div data-action="settings-editor-drag-and-drop">
              <Switch
                checked={settings.editor.dragAndDrop()}
                onChange={(checked) => settings.editor.setDragAndDrop(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorColumnSelection.title")}
            description={language.t("settings.general.row.editorColumnSelection.description")}
          >
            <div data-action="settings-editor-column-selection">
              <Switch
                checked={settings.editor.columnSelection()}
                onChange={(checked) => settings.editor.setColumnSelection(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCopyWithSyntaxHighlighting.title")}
            description={language.t("settings.general.row.editorCopyWithSyntaxHighlighting.description")}
          >
            <div data-action="settings-editor-copy-with-syntax-highlighting">
              <Switch
                checked={settings.editor.copyWithSyntaxHighlighting()}
                onChange={(checked) => settings.editor.setCopyWithSyntaxHighlighting(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorMatchBrackets.title")}
            description={language.t("settings.general.row.editorMatchBrackets.description")}
          >
            <div data-action="settings-editor-match-brackets">
              <Switch
                checked={settings.editor.matchBrackets()}
                onChange={(checked) => settings.editor.setMatchBrackets(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorColorDecorators.title")}
            description={language.t("settings.general.row.editorColorDecorators.description")}
          >
            <div data-action="settings-editor-color-decorators">
              <Switch
                checked={settings.editor.colorDecorators()}
                onChange={(checked) => settings.editor.setColorDecorators(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorRenderValidationDecorations.title")}
            description={language.t("settings.general.row.editorRenderValidationDecorations.description")}
          >
            <Select
              data-action="settings-editor-render-validation-decorations"
              options={renderValidationDecorationOptions()}
              current={renderValidationDecorationOptions().find(
                (option) => option.value === settings.editor.renderValidationDecorations(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setRenderValidationDecorations(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorUnicodeHighlightAmbiguous.title")}
            description={language.t("settings.general.row.editorUnicodeHighlightAmbiguous.description")}
          >
            <div data-action="settings-editor-unicode-highlight-ambiguous">
              <Switch
                checked={settings.editor.unicodeHighlightAmbiguous()}
                onChange={(checked) => settings.editor.setUnicodeHighlightAmbiguous(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorUnicodeHighlightInvisible.title")}
            description={language.t("settings.general.row.editorUnicodeHighlightInvisible.description")}
          >
            <div data-action="settings-editor-unicode-highlight-invisible">
              <Switch
                checked={settings.editor.unicodeHighlightInvisible()}
                onChange={(checked) => settings.editor.setUnicodeHighlightInvisible(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorRenderWhitespace.title")}
            description={language.t("settings.general.row.editorRenderWhitespace.description")}
          >
            <div data-action="settings-editor-render-whitespace">
              <Switch
                checked={settings.editor.renderWhitespace()}
                onChange={(checked) => settings.editor.setRenderWhitespace(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorRenderControlCharacters.title")}
            description={language.t("settings.general.row.editorRenderControlCharacters.description")}
          >
            <div data-action="settings-editor-render-control-characters">
              <Switch
                checked={settings.editor.renderControlCharacters()}
                onChange={(checked) => settings.editor.setRenderControlCharacters(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorBracketPairGuides.title")}
            description={language.t("settings.general.row.editorBracketPairGuides.description")}
          >
            <div data-action="settings-editor-bracket-pair-guides">
              <Switch
                checked={settings.editor.bracketPairGuides()}
                onChange={(checked) => settings.editor.setBracketPairGuides(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorBracketPairHorizontalGuides.title")}
            description={language.t("settings.general.row.editorBracketPairHorizontalGuides.description")}
          >
            <div data-action="settings-editor-bracket-pair-horizontal-guides">
              <Switch
                checked={settings.editor.bracketPairHorizontalGuides()}
                onChange={(checked) => settings.editor.setBracketPairHorizontalGuides(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorHighlightActiveBracketPair.title")}
            description={language.t("settings.general.row.editorHighlightActiveBracketPair.description")}
          >
            <div data-action="settings-editor-highlight-active-bracket-pair">
              <Switch
                checked={settings.editor.highlightActiveBracketPair()}
                onChange={(checked) => settings.editor.setHighlightActiveBracketPair(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorBracketPairColorization.title")}
            description={language.t("settings.general.row.editorBracketPairColorization.description")}
          >
            <div data-action="settings-editor-bracket-pair-colorization">
              <Switch
                checked={settings.editor.bracketPairColorization()}
                onChange={(checked) => settings.editor.setBracketPairColorization(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorIndentGuides.title")}
            description={language.t("settings.general.row.editorIndentGuides.description")}
          >
            <div data-action="settings-editor-indent-guides">
              <Switch
                checked={settings.editor.indentGuides()}
                onChange={(checked) => settings.editor.setIndentGuides(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorHighlightActiveIndentation.title")}
            description={language.t("settings.general.row.editorHighlightActiveIndentation.description")}
          >
            <div data-action="settings-editor-highlight-active-indentation">
              <Switch
                checked={settings.editor.highlightActiveIndentation()}
                onChange={(checked) => settings.editor.setHighlightActiveIndentation(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorFolding.title")}
            description={language.t("settings.general.row.editorFolding.description")}
          >
            <div data-action="settings-editor-folding">
              <Switch checked={settings.editor.folding()} onChange={(checked) => settings.editor.setFolding(checked)} />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorShowFoldingControls.title")}
            description={language.t("settings.general.row.editorShowFoldingControls.description")}
          >
            <Select
              data-action="settings-editor-show-folding-controls"
              options={showFoldingControlsOptions()}
              current={showFoldingControlsOptions().find(
                (option) => option.value === settings.editor.showFoldingControls(),
              )}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setShowFoldingControls(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorSmoothScrolling.title")}
            description={language.t("settings.general.row.editorSmoothScrolling.description")}
          >
            <div data-action="settings-editor-smooth-scrolling">
              <Switch
                checked={settings.editor.smoothScrolling()}
                onChange={(checked) => settings.editor.setSmoothScrolling(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorCursorAnimation.title")}
            description={language.t("settings.general.row.editorCursorAnimation.description")}
          >
            <div data-action="settings-editor-cursor-animation">
              <Switch
                checked={settings.editor.cursorAnimation()}
                onChange={(checked) => settings.editor.setCursorAnimation(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorMouseWheelZoom.title")}
            description={language.t("settings.general.row.editorMouseWheelZoom.description")}
          >
            <div data-action="settings-editor-mouse-wheel-zoom">
              <Switch
                checked={settings.editor.mouseWheelZoom()}
                onChange={(checked) => settings.editor.setMouseWheelZoom(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorStickyScroll.title")}
            description={language.t("settings.general.row.editorStickyScroll.description")}
          >
            <div data-action="settings-editor-sticky-scroll">
              <Switch
                checked={settings.editor.stickyScroll()}
                onChange={(checked) => settings.editor.setStickyScroll(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorScrollBeyondLastLine.title")}
            description={language.t("settings.general.row.editorScrollBeyondLastLine.description")}
          >
            <div data-action="settings-editor-scroll-beyond-last-line">
              <Switch
                checked={settings.editor.scrollBeyondLastLine()}
                onChange={(checked) => settings.editor.setScrollBeyondLastLine(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorRulers.title")}
            description={language.t("settings.general.row.editorRulers.description")}
          >
            <Select
              data-action="settings-editor-rulers"
              options={rulerOptions()}
              current={rulerOptions().find(
                (option) =>
                  option.key === (settings.editor.rulers().length > 0 ? settings.editor.rulers().join(",") : "off"),
              )}
              value={(option) => option.key}
              label={(option) => option.label}
              onSelect={(option) => option && settings.editor.setRulers(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorRenderFinalNewline.title")}
            description={language.t("settings.general.row.editorRenderFinalNewline.description")}
          >
            <div data-action="settings-editor-render-final-newline">
              <Switch
                checked={settings.editor.renderFinalNewline()}
                onChange={(checked) => settings.editor.setRenderFinalNewline(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorTrimAutoWhitespace.title")}
            description={language.t("settings.general.row.editorTrimAutoWhitespace.description")}
          >
            <div data-action="settings-editor-trim-auto-whitespace">
              <Switch
                checked={settings.editor.trimAutoWhitespace()}
                onChange={(checked) => settings.editor.setTrimAutoWhitespace(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorFormatOnPaste.title")}
            description={language.t("settings.general.row.editorFormatOnPaste.description")}
          >
            <div data-action="settings-editor-format-on-paste">
              <Switch
                checked={settings.editor.formatOnPaste()}
                onChange={(checked) => settings.editor.setFormatOnPaste(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorFormatOnType.title")}
            description={language.t("settings.general.row.editorFormatOnType.description")}
          >
            <div data-action="settings-editor-format-on-type">
              <Switch
                checked={settings.editor.formatOnType()}
                onChange={(checked) => settings.editor.setFormatOnType(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.editorFormatOnSave.title")}
            description={language.t("settings.general.row.editorFormatOnSave.description")}
          >
            <div data-action="settings-editor-format-on-save">
              <Switch
                checked={settings.editor.formatOnSave()}
                onChange={(checked) => settings.editor.setFormatOnSave(checked)}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.experimentalCodeEditor.title")}
            description={language.t("settings.general.row.experimentalCodeEditor.description")}
          >
            <div data-action="settings-editor-experimental">
              <Switch
                checked={isCodeEditorPhase0Enabled()}
                onChange={(checked) => setCodeEditorPhase0Enabled(checked)}
              />
            </div>
          </SettingsRow>
        </SettingsList>
      </SettingsSection>
    </SettingsPageShell>
  )
}
