import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { isNormalizedPromptEditor, parsePromptEditor, renderPromptEditor } from "./editor-parse"

describe("prompt-input editor parse helpers", () => {
  test("renders and parses mixed prompt parts", () => {
    const editor = document.createElement("div")
    const prompt = [
      { type: "text", content: "hello ", start: 0, end: 6 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 6, end: 17 },
      { type: "text", content: "\nworld ", start: 17, end: 24 },
      {
        type: "web-reference",
        label: "Example",
        text: "excerpt",
        url: "https://example.com",
        mode: "selection",
        content: "[Example]",
        start: 24,
        end: 33,
      },
    ] satisfies Prompt

    renderPromptEditor(editor, prompt)

    expect(isNormalizedPromptEditor(editor)).toBe(true)
    expect(parsePromptEditor(editor)).toEqual(prompt)
  })

  test("keeps trailing newline roundtrip stable with zero-width placeholder", () => {
    const editor = document.createElement("div")
    const prompt = [{ type: "text", content: "line 1\n", start: 0, end: 7 }] satisfies Prompt

    renderPromptEditor(editor, prompt)

    expect(editor.lastChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(editor.lastChild?.textContent).toBe("\u200B")
    expect(parsePromptEditor(editor)).toEqual(prompt)
  })

  test("normalizes block nodes into newlines", () => {
    const editor = document.createElement("div")
    editor.innerHTML = "<div>first</div><div>second</div>"

    expect(parsePromptEditor(editor)).toEqual([{ type: "text", content: "first\nsecond", start: 0, end: 12 }])
  })

  test("flags unexpected zero-width text as non-normalized", () => {
    const editor = document.createElement("div")
    editor.appendChild(document.createTextNode("bad\u200Btext"))

    expect(isNormalizedPromptEditor(editor)).toBe(false)
  })
})
