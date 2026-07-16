import { afterEach, describe, expect, mock, test } from "bun:test"
import { getCursorPosition } from "./editor-dom"
import {
  clearPromptEditor,
  scheduleFocusPromptEditorEnd,
  scheduleRestorePromptEditor,
  setPromptEditorText,
} from "./editor-focus"

const originalRequestAnimationFrame = globalThis.requestAnimationFrame

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
})

describe("prompt-input editor focus helpers", () => {
  test("clears and replaces editor text", () => {
    const editor = document.createElement("div")
    editor.innerHTML = "<span>old</span>"

    clearPromptEditor(editor)
    expect(editor.innerHTML).toBe("")

    setPromptEditorText(editor, "hello")
    expect(editor.textContent).toBe("hello")
  })

  test("focuses the editor end on the next frame", () => {
    globalThis.requestAnimationFrame = mock((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const editor = document.createElement("div")
    editor.textContent = "hello"
    document.body.appendChild(editor)

    scheduleFocusPromptEditorEnd(editor)
    expect(getCursorPosition(editor)).toBe(5)
  })

  test("restores the editor cursor and runs follow-up work", () => {
    globalThis.requestAnimationFrame = mock((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const editor = document.createElement("div")
    editor.textContent = "hello"
    document.body.appendChild(editor)
    let called = false

    scheduleRestorePromptEditor(editor, 2, () => {
      called = true
    })

    expect(getCursorPosition(editor)).toBe(2)
    expect(called).toBe(true)
  })
})
