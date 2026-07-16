import type { Prompt, WebReferenceAttachmentPart } from "@/context/prompt"

export type BrowserReferenceCandidate = {
  label?: string
  text?: string
  url?: string
  title?: string
  selector?: string
  mode?: "selection" | "element"
}

export type BrowserReferenceState = {
  selection?: BrowserReferenceCandidate
  element?: BrowserReferenceCandidate
}

function promptContentLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

function normalizedPrompt(prompt: Prompt) {
  if (prompt.length === 1 && prompt[0]?.type === "text" && prompt[0].content.length === 0) return []
  return [...prompt]
}

export function buildWebReferenceAttachment(candidate: BrowserReferenceCandidate | undefined) {
  const url = candidate?.url?.trim()
  const text = candidate?.text?.trim()
  if (!url || !text) return
  const title = candidate?.title?.trim() || candidate?.label?.trim() || url
  const content = candidate?.mode === "element" ? `[element:${title}]` : `[web:${title}]`
  return {
    type: "web-reference",
    label: title,
    text,
    url,
    title,
    selector: candidate?.selector?.trim() || undefined,
    mode: candidate?.mode === "element" ? "element" : "selection",
    content,
  } satisfies Omit<WebReferenceAttachmentPart, "start" | "end">
}

export function appendBrowserReferenceToPrompt(currentPrompt: Prompt, candidate: BrowserReferenceCandidate | undefined) {
  const part = buildWebReferenceAttachment(candidate)
  if (!part) return
  const next = normalizedPrompt(currentPrompt)
  const start = promptContentLength(next)
  const attachment: WebReferenceAttachmentPart = {
    ...part,
    start,
    end: start + part.content.length,
  }
  return {
    prompt: [...next, attachment],
    cursor: start + part.content.length,
    attachment,
  }
}
