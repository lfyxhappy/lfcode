export type CodeEditorCapabilityPreset = "sidebar-full" | "inline-mini"

type CodeEditorCapabilities = {
  showStatusBar: boolean
  options: import("monaco-editor").editor.IStandaloneEditorConstructionOptions
}

export function getCodeEditorCapabilities(preset: CodeEditorCapabilityPreset): CodeEditorCapabilities {
  if (preset === "inline-mini") {
    return {
      showStatusBar: false,
      options: {
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        fontSize: 12,
        lineHeight: 20,
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: false,
        glyphMargin: false,
        stickyScroll: { enabled: false },
        lineNumbers: "off",
        folding: false,
        renderLineHighlightOnlyWhenFocus: true,
        overviewRulerLanes: 0,
      },
    }
  }

  return {
    showStatusBar: true,
    options: {
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineHeight: 22,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      glyphMargin: false,
      stickyScroll: { enabled: false },
      lineNumbers: "on",
      folding: true,
      renderLineHighlightOnlyWhenFocus: false,
      overviewRulerLanes: 2,
    },
  }
}
