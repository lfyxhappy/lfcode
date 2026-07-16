import { describe, expect, test } from "bun:test"
import { getFileReferenceEventElement } from "./markdown-file-reference"

describe("markdown file reference event targeting", () => {
  test("resolves file reference anchors when the event target is a text node", () => {
    const root = document.createElement("div")
    root.innerHTML = '<a class="file-reference" data-kind="file-ref" data-path="C:/tmp/demo.txt">C:/tmp/demo.txt</a>'

    const text = root.querySelector("a")?.firstChild ?? null
    const element = getFileReferenceEventElement(text)

    expect(element).toBeInstanceOf(HTMLElement)
    expect(element?.dataset.path).toBe("C:/tmp/demo.txt")
  })
})
