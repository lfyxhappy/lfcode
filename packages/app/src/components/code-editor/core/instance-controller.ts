import { preflightMonacoEditor } from "@lfcode-ai/ui/monaco-kernel"
import type { CodeEditorRuntime } from "@/components/code-editor/core/runtime"

export function createEditorInstanceController(input: {
  runtime: CodeEditorRuntime
  host: HTMLElement
  options: import("monaco-editor").editor.IStandaloneEditorConstructionOptions
  onInput: (modelVersion: number) => void
  onCursor: (position: { line: number; column: number }) => void
  onSave?: VoidFunction
}) {
  const editor = input.runtime.createEditor(input.host, {
    ...input.options,
    model: null,
  })
  try {
    preflightMonacoEditor(editor)
  } catch (error) {
    editor.dispose()
    throw error
  }

  let syncing = false
  const disposables = [
    editor.onKeyDown((event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.keyCode !== input.runtime.monaco.KeyCode.KeyS) return
      event.preventDefault()
      event.stopPropagation()
      input.onSave?.()
    }),
    editor.onDidChangeModelContent(() => {
      if (syncing) return
      input.onInput(editor.getModel()?.getVersionId() ?? 0)
    }),
    editor.onDidChangeCursorPosition((event) => {
      input.onCursor({ line: event.position.lineNumber, column: event.position.column })
    }),
  ]

  return {
    editor,
    setModel: (model: import("monaco-editor").editor.ITextModel | null) => {
      syncing = true
      editor.setModel(model)
      syncing = false
    },
    applyExternalValue: (value: string) => {
      if (editor.getValue() === value) return
      syncing = true
      editor.setValue(value)
      syncing = false
    },
    updateOptions: (options: import("monaco-editor").editor.IEditorOptions) => editor.updateOptions(options),
    dispose: () => {
      disposables.forEach((disposable) => disposable.dispose())
      editor.dispose()
    },
  }
}

export type EditorInstanceController = ReturnType<typeof createEditorInstanceController>
