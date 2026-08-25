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

  test("keeps regular web-link context menus out of the file-reference trigger", () => {
    const trigger = document.createElement("div")
    const markdown = document.createElement("div")
    const webLink = document.createElement("a")
    webLink.href = "https://example.com"
    webLink.textContent = "example.com"
    markdown.append(webLink)
    trigger.append(markdown)

    let triggerOpened = false
    markdown.addEventListener("contextmenu", (event) => {
      if (getFileReferenceEventElement(event.target)) return
      event.stopPropagation()
    })
    trigger.addEventListener("contextmenu", (event) => {
      triggerOpened = true
      event.preventDefault()
    })

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    webLink.dispatchEvent(event)

    expect(triggerOpened).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  test("allows file-reference context menus to reach the file-reference trigger", () => {
    const trigger = document.createElement("div")
    const markdown = document.createElement("div")
    markdown.innerHTML = '<a data-kind="file-ref" data-path="C:/tmp/demo.txt">C:/tmp/demo.txt</a>'
    trigger.append(markdown)

    let triggerOpened = false
    markdown.addEventListener("contextmenu", (event) => {
      if (getFileReferenceEventElement(event.target)) return
      event.stopPropagation()
    })
    trigger.addEventListener("contextmenu", (event) => {
      triggerOpened = true
      event.preventDefault()
    })

    const fileReference = markdown.querySelector("a")
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    fileReference?.dispatchEvent(event)

    expect(triggerOpened).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })
})
