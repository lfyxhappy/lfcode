import type { Prompt } from "@/context/prompt"

const NON_EMPTY_TEXT = /[^\s\u200B]/

export function promptInputText(parts: Prompt) {
  return parts
    .filter((part) => part.type !== "selected-text")
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
}

export function isPromptInputBlank(input: {
  prompt: Prompt
  imageCount: number
  commentCount: number
  selectedTextCount?: number
}) {
  return (
    !NON_EMPTY_TEXT.test(promptInputText(input.prompt)) &&
    input.imageCount === 0 &&
    input.commentCount === 0 &&
    (input.selectedTextCount ?? 0) === 0
  )
}

export function shouldResetPromptInput(input: {
  prompt: Prompt
  imageCount: number
  selectedTextCount?: number
}) {
  return (
    !NON_EMPTY_TEXT.test(promptInputText(input.prompt)) &&
    input.imageCount === 0 &&
    (input.selectedTextCount ?? 0) === 0 &&
    input.prompt.every((part) => part.type === "text")
  )
}
