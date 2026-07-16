import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { isPromptInputBlank, promptInputText, shouldResetPromptInput } from "./state"

describe("prompt-input state helpers", () => {
  test("joins prompt content into plain text", () => {
    const prompt = [
      { type: "text", content: "hello ", start: 0, end: 6 },
      { type: "file", path: "a.ts", content: "@a.ts", start: 6, end: 11 },
      { type: "text", content: " world", start: 11, end: 17 },
    ] satisfies Prompt

    expect(promptInputText(prompt)).toBe("hello @a.ts world")
  })

  test("treats whitespace-only text with no attachments as blank", () => {
    const prompt = [{ type: "text", content: "  \n\u200B", start: 0, end: 4 }] satisfies Prompt
    expect(isPromptInputBlank({ prompt, imageCount: 0, commentCount: 0 })).toBe(true)
  })

  test("does not treat comments or images as blank", () => {
    const prompt = [{ type: "text", content: "", start: 0, end: 0 }] satisfies Prompt
    expect(isPromptInputBlank({ prompt, imageCount: 1, commentCount: 0 })).toBe(false)
    expect(isPromptInputBlank({ prompt, imageCount: 0, commentCount: 1 })).toBe(false)
  })

  test("only resets when the prompt is text-only and empty", () => {
    const emptyTextOnly = [{ type: "text", content: " \n", start: 0, end: 2 }] satisfies Prompt
    const withAttachment = [
      { type: "text", content: "", start: 0, end: 0 },
      { type: "agent", name: "helper", content: "$helper", start: 0, end: 7 },
    ] satisfies Prompt

    expect(shouldResetPromptInput({ prompt: emptyTextOnly, imageCount: 0 })).toBe(true)
    expect(shouldResetPromptInput({ prompt: withAttachment, imageCount: 0 })).toBe(false)
    expect(shouldResetPromptInput({ prompt: emptyTextOnly, imageCount: 1 })).toBe(false)
  })
})
