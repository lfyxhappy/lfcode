import { describe, expect, test } from "bun:test"
import { setCursorPosition } from "./editor-dom"
import { getPromptCaretState, getPromptCurrentCursor, shouldBlurPromptOnEscape } from "./editor-selection"

describe("prompt-input editor selection helpers", () => {
  test("reads caret state and current cursor from the active editor selection", () => {
    const editor = document.createElement("div")
    editor.textContent = "hello"
    document.body.appendChild(editor)

    setCursorPosition(editor, 3)

    expect(getPromptCaretState(editor, 5)).toEqual({
      collapsed: true,
      cursorPosition: 3,
      textLength: 5,
    })
    expect(getPromptCurrentCursor(editor)).toBe(3)
  })

  test("falls back when the selection is missing or outside the editor", () => {
    const editor = document.createElement("div")
    editor.textContent = "hello"
    document.body.appendChild(editor)

    const outside = document.createElement("div")
    outside.textContent = "outside"
    document.body.appendChild(outside)

    const range = document.createRange()
    range.setStart(outside.firstChild!, 2)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(getPromptCaretState(editor, 5)).toEqual({
      collapsed: false,
      cursorPosition: 0,
      textLength: 5,
    })
    expect(getPromptCurrentCursor(editor)).toBeNull()
  })

  test("only enables escape blur on mac desktop", () => {
    expect(shouldBlurPromptOnEscape("desktop", "macos")).toBe(true)
    expect(shouldBlurPromptOnEscape("desktop", "windows")).toBe(false)
    expect(shouldBlurPromptOnEscape("web", "macos")).toBe(false)
  })
})
