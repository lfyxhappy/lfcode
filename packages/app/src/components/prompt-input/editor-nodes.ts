import type {
  AgentPart,
  FileAttachmentPart,
  SelectedTextAttachmentPart,
  WebReferenceAttachmentPart,
} from "@/context/prompt"

export type PromptInlineAttachmentPart =
  | FileAttachmentPart
  | AgentPart
  | SelectedTextAttachmentPart
  | WebReferenceAttachmentPart

function decoratePromptPill(pill: HTMLSpanElement) {
  pill.setAttribute("contenteditable", "false")
  pill.style.userSelect = "text"
  pill.style.cursor = "default"
  return pill
}

export function createPromptInlineAttachmentNode(part: PromptInlineAttachmentPart) {
  const pill = decoratePromptPill(document.createElement("span"))

  if (part.type === "file") {
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    pill.setAttribute("data-path", part.path)
    return pill
  }

  if (part.type === "agent") {
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    pill.setAttribute("data-name", part.name)
    return pill
  }

  if (part.type === "selected-text") {
    pill.textContent = part.text
    pill.setAttribute("data-type", part.type)
    if (part.messageID) pill.setAttribute("data-message-id", part.messageID)
    if (part.selection) {
      pill.setAttribute("data-start-line", String(part.selection.startLine))
      pill.setAttribute("data-end-line", String(part.selection.endLine))
    }
    return pill
  }

  pill.textContent = part.content
  pill.setAttribute("data-type", part.type)
  pill.setAttribute("data-label", part.label)
  pill.setAttribute("data-url", part.url)
  pill.setAttribute("data-mode", part.mode)
  pill.setAttribute("data-text", part.text)
  if (part.title) pill.setAttribute("data-title", part.title)
  if (part.selector) pill.setAttribute("data-selector", part.selector)
  return pill
}
