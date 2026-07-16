import { getCursorPosition } from "./editor-dom"

export function getPromptCaretState(editor: HTMLElement, textLength: number) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { collapsed: false, cursorPosition: 0, textLength }
  }

  const anchorNode = selection.anchorNode
  if (!anchorNode || !editor.contains(anchorNode)) {
    return { collapsed: false, cursorPosition: 0, textLength }
  }

  return {
    collapsed: selection.isCollapsed,
    cursorPosition: getCursorPosition(editor),
    textLength,
  }
}

export function getPromptCurrentCursor(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return null
  return getCursorPosition(editor)
}

export function shouldBlurPromptOnEscape(platform: string | undefined, os: string | undefined) {
  return platform === "desktop" && os === "macos"
}
