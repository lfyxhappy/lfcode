import type { Prompt } from "@/context/prompt"
import { createTextFragment } from "./editor-dom"
import { createPromptInlineAttachmentNode } from "./editor-nodes"

const EMPTY_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function isPromptPill(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const type = (node as HTMLElement).dataset.type
  return type === "file" || type === "agent" || type === "selected-text" || type === "web-reference"
}

function normalizedTextContent(text: string) {
  let content = text
  if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
  if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
  return content
}

export function isNormalizedPromptEditor(editor: HTMLElement) {
  return Array.from(editor.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (!text.includes("\u200B")) return true
      if (text !== "\u200B") return false

      const prev = node.previousSibling
      const next = node.nextSibling
      const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
      return !!prevIsBr && !next
    }

    if (isPromptPill(node)) return true
    return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"
  })
}

export function renderPromptEditor(editor: HTMLElement, parts: Prompt) {
  editor.replaceChildren()

  for (const part of parts) {
    if (part.type === "image") continue
    if (part.type === "selected-text") continue
    if (part.type === "text") {
      editor.appendChild(createTextFragment(part.content))
      continue
    }
    editor.appendChild(createPromptInlineAttachmentNode(part))
  }

  const last = editor.lastChild
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
    editor.appendChild(document.createTextNode("\u200B"))
  }
}

export function parsePromptEditor(editor: HTMLElement): Prompt {
  const parts: Prompt = []
  let position = 0
  let buffer = ""

  const flushText = () => {
    const content = normalizedTextContent(buffer)
    buffer = ""
    if (!content) return
    parts.push({ type: "text", content, start: position, end: position + content.length })
    position += content.length
  }

  const pushInlinePart = (node: HTMLElement) => {
    const content = node.textContent ?? ""
    const type = node.dataset.type
    if (type === "file") {
      parts.push({
        type,
        path: node.dataset.path ?? "",
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
      return
    }

    if (type === "agent") {
      parts.push({
        type,
        name: node.dataset.name ?? "",
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
      return
    }

    if (type === "selected-text") {
      parts.push({
        type,
        text: content,
        content: "",
        start: position,
        end: position,
        selection: undefined,
      })
      return
    }

    parts.push({
      type: "web-reference",
      label: node.dataset.label ?? content,
      text: node.dataset.text ?? "",
      url: node.dataset.url ?? "",
      title: node.dataset.title,
      selector: node.dataset.selector,
      mode: node.dataset.mode === "element" ? "element" : "selection",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement

    if (isPromptPill(element)) {
      flushText()
      pushInlinePart(element)
      return
    }

    if (element.tagName === "BR") {
      buffer += "\n"
      return
    }

    for (const child of Array.from(element.childNodes)) {
      visit(child)
    }
  }

  const children = Array.from(editor.childNodes)
  children.forEach((child, index) => {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
    visit(child)
    if (isBlock && index < children.length - 1) buffer += "\n"
  })

  flushText()
  if (parts.length === 0) parts.push(...EMPTY_PROMPT)
  return parts
}
