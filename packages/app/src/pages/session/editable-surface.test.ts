import { beforeEach, describe, expect, test } from "bun:test"
import { shouldFocusComposerFromPointer, shouldRoutePrintableKeyToComposer } from "./editable-surface"

function keydown(
  target: HTMLElement,
  options: KeyboardEventInit & {
    keyCode?: number
    isComposing?: boolean
  } = {},
) {
  const { isComposing, keyCode, ...init } = options
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", ...init })
  if (isComposing !== undefined) Object.defineProperty(event, "isComposing", { value: isComposing })
  if (keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: keyCode })
  target.dispatchEvent(event)
  return event
}

describe("shouldRoutePrintableKeyToComposer", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("routes printable keys only from the unowned document body or session canvas", () => {
    const event = keydown(document.body)
    expect(shouldRoutePrintableKeyToComposer({ event, activeElement: document.body, dialogActive: false })).toBe(true)

    const canvas = document.createElement("main")
    canvas.dataset.sessionCanvas = ""
    document.body.append(canvas)
    expect(
      shouldRoutePrintableKeyToComposer({ event: keydown(canvas), activeElement: canvas, dialogActive: false }),
    ).toBe(true)
  })

  test("does not steal keys from Monaco, fallback, composer, or terminal input", () => {
    document.body.innerHTML = `
      <div data-editable-surface="code-editor"><textarea class="inputarea"></textarea></div>
      <textarea data-editable-surface="editor-fallback"></textarea>
      <div data-editable-surface="composer"><textarea></textarea></div>
      <div data-editable-surface="terminal"><textarea></textarea></div>
    `

    for (const input of document.querySelectorAll<HTMLElement>("textarea")) {
      expect(
        shouldRoutePrintableKeyToComposer({ event: keydown(input), activeElement: input, dialogActive: false }),
      ).toBe(false)
    }
  })

  test("does not steal keys from native and semantic interactive surfaces", () => {
    document.body.innerHTML = `
      <a href="#">link</a>
      <div contenteditable>editable</div>
      <div role="button"></div>
      <div role="link"></div>
      <div role="combobox"></div>
      <webview></webview>
      <iframe></iframe>
    `

    for (const surface of document.querySelectorAll<HTMLElement>("a, div, webview, iframe")) {
      expect(
        shouldRoutePrintableKeyToComposer({ event: keydown(surface), activeElement: surface, dialogActive: false }),
      ).toBe(false)
    }
  })

  test("blocks only explicit active overlays and active dialogs", () => {
    document.body.innerHTML = '<div role="menu"></div>'
    expect(
      shouldRoutePrintableKeyToComposer({
        event: keydown(document.body),
        activeElement: document.body,
        dialogActive: false,
      }),
    ).toBe(true)

    document.body.innerHTML = '<div role="menu" data-focus-overlay="menu"></div>'
    expect(
      shouldRoutePrintableKeyToComposer({
        event: keydown(document.body),
        activeElement: document.body,
        dialogActive: false,
      }),
    ).toBe(false)

    document.body.innerHTML = '<div role="dialog" data-focus-overlay="dialog"></div>'
    expect(
      shouldRoutePrintableKeyToComposer({
        event: keydown(document.body),
        activeElement: document.body,
        dialogActive: false,
      }),
    ).toBe(false)

    document.body.innerHTML = '<div role="dialog" data-focus-overlay="dialog" data-closed></div>'
    expect(
      shouldRoutePrintableKeyToComposer({
        event: keydown(document.body),
        activeElement: document.body,
        dialogActive: false,
      }),
    ).toBe(true)
    expect(
      shouldRoutePrintableKeyToComposer({
        event: keydown(document.body),
        activeElement: document.body,
        dialogActive: true,
      }),
    ).toBe(false)
  })

  test("does not route IME composition, modified, or already handled key events", () => {
    for (const options of [
      { isComposing: true },
      { keyCode: 229 },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect(
        shouldRoutePrintableKeyToComposer({
          event: keydown(document.body, options),
          activeElement: document.body,
          dialogActive: false,
        }),
      ).toBe(false)
    }

    const handled = keydown(document.body)
    handled.preventDefault()
    expect(
      shouldRoutePrintableKeyToComposer({ event: handled, activeElement: document.body, dialogActive: false }),
    ).toBe(false)
  })
})

describe("shouldFocusComposerFromPointer", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("focuses the composer only from its noninteractive blank area", () => {
    const composer = document.createElement("div")
    const blank = document.createElement("div")
    const action = document.createElement("button")
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    composer.append(blank, action, editor)
    document.body.append(composer)

    expect(shouldFocusComposerFromPointer({ target: composer, composer })).toBe(true)
    expect(shouldFocusComposerFromPointer({ target: blank, composer })).toBe(true)
    expect(shouldFocusComposerFromPointer({ target: action, composer })).toBe(false)
    expect(shouldFocusComposerFromPointer({ target: editor, composer })).toBe(false)
  })

  test("does not claim pointer events outside the composer", () => {
    const composer = document.createElement("div")
    const external = document.createElement("div")
    document.body.append(composer, external)

    expect(shouldFocusComposerFromPointer({ target: external, composer })).toBe(false)
  })
})
