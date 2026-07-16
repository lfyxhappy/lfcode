import { setCursorPosition } from "./editor-dom"

export function clearPromptEditor(editor: HTMLElement) {
  editor.innerHTML = ""
}

export function setPromptEditorText(editor: HTMLElement, text: string) {
  clearPromptEditor(editor)
  editor.textContent = text
}

export function scheduleFocusPromptEditorEnd(editor: HTMLElement) {
  requestAnimationFrame(() => {
    editor.focus()
    const range = document.createRange()
    const selection = window.getSelection()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}

export function scheduleRestorePromptEditor(editor: HTMLElement, cursor: number, onAfter?: VoidFunction) {
  requestAnimationFrame(() => {
    editor.focus()
    setCursorPosition(editor, cursor)
    onAfter?.()
  })
}
