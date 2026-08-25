import type { ContextItem, Prompt } from "@/context/prompt"

export type ExternalAgentPrompt = {
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}

export function formatExternalAgentPrompt(input: ExternalAgentPrompt) {
  const text = input.prompt
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("")
    .trim()
  const files = input.prompt
    .filter((part) => part.type === "file")
    .map((part) => formatFile(part.path, part.selection))
  const selections = input.prompt
    .filter((part) => part.type === "selected-text")
    .map((part) => {
      const note = part.comment?.trim()
      return ["[选中文本]", selectionRange(part.selection), note ? `说明：${note}` : undefined, fence(part.text)].filter(Boolean).join("\n")
    })
  const references = input.prompt
    .filter((part) => part.type === "web-reference")
    .map((part) => ["[网页引用]", part.title ?? part.label, part.url, fence(part.text)].filter(Boolean).join("\n"))
  const context = input.context.map((item) => {
    const note = item.comment?.trim()
    return [formatFile(item.path, item.selection), note ? `说明：${note}` : undefined, item.preview ? fence(item.preview) : undefined]
      .filter(Boolean)
      .join("\n")
  })

  return [text, ...unique(files), ...unique(selections), ...unique(references), ...unique(context)].filter(Boolean).join("\n\n")
}

function formatFile(path: string, selection?: { startLine: number; endLine: number }) {
  return `[文件] ${path}${selectionRange(selection)}`
}

function selectionRange(selection?: { startLine: number; endLine: number }) {
  if (!selection) return ""
  if (selection.startLine === selection.endLine) return `:${selection.startLine}`
  return `:${selection.startLine}-${selection.endLine}`
}

function fence(value: string) {
  return `\`\`\`text\n${value}\n\`\`\``
}

function unique(values: string[]) {
  return [...new Set(values)]
}
