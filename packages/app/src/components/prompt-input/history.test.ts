import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  canNavigateHistoryAtCursor,
  clonePromptParts,
  compactPromptHistoryEntries,
  normalizePromptHistoryEntry,
  navigatePromptHistory,
  prependHistoryEntry,
  promptLength,
  type PromptHistoryComment,
} from "./history"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const text = (value: string): Prompt => [{ type: "text", content: value, start: 0, end: value.length }]
const selected = (value: string, messageID = "msg_1"): Prompt => [
  {
    type: "selected-text",
    text: value,
    content: value,
    start: 0,
    end: value.length,
    messageID,
    selection: { startLine: 1, startChar: 1, endLine: 1, endChar: value.length },
  },
]
const webReference = (value: string, url = "https://example.com/article"): Prompt => [
  {
    type: "web-reference",
    label: "Example article",
    text: value,
    url,
    title: "Example article",
    selector: "main article",
    mode: "selection",
    content: "[web:Example article]",
    start: 0,
    end: 21,
  },
]
const comment = (id: string, value = "note"): PromptHistoryComment => ({
  id,
  path: "src/a.ts",
  selection: { start: 2, end: 4 },
  comment: value,
  time: 1,
  origin: "review",
  preview: "const a = 1",
})

describe("prompt-input history", () => {
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    const first = prependHistoryEntry([], DEFAULT_PROMPT)
    expect(first).toEqual([])

    const commentsOnly = prependHistoryEntry([], DEFAULT_PROMPT, [comment("c1")])
    expect(commentsOnly).toHaveLength(1)

    const withOne = prependHistoryEntry([], text("hello"))
    expect(withOne).toHaveLength(1)

    const deduped = prependHistoryEntry(withOne, text("hello"))
    expect(deduped).toBe(withOne)

    const dedupedComments = prependHistoryEntry(commentsOnly, DEFAULT_PROMPT, [comment("c1")])
    expect(dedupedComments).toBe(commentsOnly)
  })

  test("prependHistoryEntry distinguishes different selected-text attachments", () => {
    const withOne = prependHistoryEntry([], selected("alpha"))
    const withDifferent = prependHistoryEntry(withOne, selected("beta"))

    expect(withDifferent).toHaveLength(2)
    expect(normalizePromptHistoryEntry(withDifferent[0]).prompt[0]).toMatchObject({ type: "selected-text", text: "beta" })
    expect(normalizePromptHistoryEntry(withDifferent[1]).prompt[0]).toMatchObject({ type: "selected-text", text: "alpha" })
  })

  test("prependHistoryEntry distinguishes different web references", () => {
    const withOne = prependHistoryEntry([], webReference("alpha excerpt"))
    const withDifferent = prependHistoryEntry(withOne, webReference("beta excerpt"))

    expect(withDifferent).toHaveLength(2)
    expect(normalizePromptHistoryEntry(withDifferent[0]).prompt[0]).toMatchObject({
      type: "web-reference",
      text: "beta excerpt",
    })
  })

  test("navigatePromptHistory restores saved prompt when moving down from newest", () => {
    const entries = [text("third"), text("second"), text("first")]
    const up = navigatePromptHistory({
      direction: "up",
      entries,
      historyIndex: -1,
      currentPrompt: text("draft"),
      currentComments: [comment("draft")],
      savedPrompt: null,
    })
    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.historyIndex).toBe(0)
    expect(up.cursor).toBe("start")
    expect(up.entry.comments).toEqual([])

    const down = navigatePromptHistory({
      direction: "down",
      entries,
      historyIndex: up.historyIndex,
      currentPrompt: text("ignored"),
      currentComments: [],
      savedPrompt: up.savedPrompt,
    })
    expect(down.handled).toBe(true)
    if (!down.handled) throw new Error("expected handled")
    expect(down.historyIndex).toBe(-1)
    expect(down.entry.prompt[0]?.type === "text" ? down.entry.prompt[0].content : "").toBe("draft")
    expect(down.entry.comments).toEqual([comment("draft")])
  })

  test("navigatePromptHistory keeps entry comments when moving through history", () => {
    const entries = [
      {
        prompt: text("with comment"),
        comments: [comment("c1")],
      },
    ]

    const up = navigatePromptHistory({
      direction: "up",
      entries,
      historyIndex: -1,
      currentPrompt: text("draft"),
      currentComments: [],
      savedPrompt: null,
    })

    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.entry.prompt[0]?.type === "text" ? up.entry.prompt[0].content : "").toBe("with comment")
    expect(up.entry.comments).toEqual([comment("c1")])
  })

  test("normalizePromptHistoryEntry supports legacy prompt arrays", () => {
    const entry = normalizePromptHistoryEntry(text("legacy"))
    expect(entry.prompt[0]?.type === "text" ? entry.prompt[0].content : "").toBe("legacy")
    expect(entry.comments).toEqual([])
  })

  test("helpers clone prompt and count text content length", () => {
    const original: Prompt = [
      { type: "text", content: "one", start: 0, end: 3 },
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 3,
        end: 12,
        selection: { startLine: 1, startChar: 1, endLine: 2, endChar: 1 },
      },
      { type: "image", id: "1", filename: "img.png", mime: "image/png", dataUrl: "data:image/png;base64,abc" },
    ]
    const copy = clonePromptParts(original)
    expect(copy).not.toBe(original)
    expect(promptLength(copy)).toBe(12)
    if (copy[1]?.type !== "file") throw new Error("expected file")
    copy[1].selection!.startLine = 9
    if (original[1]?.type !== "file") throw new Error("expected file")
    expect(original[1].selection?.startLine).toBe(1)
  })

  test("history cloning trims oversized selected text, comments, and image payloads", () => {
    const oversized = normalizePromptHistoryEntry({
      prompt: [
        {
          type: "selected-text",
          text: "x".repeat(5_000),
          content: "x".repeat(5_000),
          start: 0,
          end: 5_000,
          messageID: "msg_1",
          selection: { startLine: 1, startChar: 1, endLine: 1, endChar: 5_000 },
        },
        {
          type: "image",
          id: "img_1",
          filename: "big.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64," + "A".repeat(130_000),
        },
      ],
      comments: [comment("c1", "n".repeat(3_000))],
    })

    expect(oversized.prompt).toHaveLength(1)
    expect(oversized.prompt[0]).toMatchObject({
      type: "selected-text",
      text: "x".repeat(4_000),
      content: "x".repeat(4_000),
    })
    expect(oversized.comments[0]?.comment).toBe("n".repeat(2_000))
  })

  test("compactPromptHistoryEntries normalizes existing oversized entries", () => {
    const original = [
      {
        prompt: [
          {
            type: "selected-text" as const,
            text: "x".repeat(5_000),
            content: "x".repeat(5_000),
            start: 0,
            end: 5_000,
            messageID: "msg_1",
            selection: { startLine: 1, startChar: 1, endLine: 1, endChar: 5_000 },
          },
        ],
        comments: [],
      },
    ]
    const compacted = compactPromptHistoryEntries(original)
    expect(compacted).not.toBe(original)
    expect(normalizePromptHistoryEntry(compacted[0]!).prompt[0]).toMatchObject({
      type: "selected-text",
      text: "x".repeat(4_000),
    })
  })

  test("canNavigateHistoryAtCursor only allows prompt boundaries", () => {
    const value = "a\nb\nc"

    expect(canNavigateHistoryAtCursor("up", value, 0)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 0)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", value, 2)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 2)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", value, 5)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 5)).toBe(true)

    expect(canNavigateHistoryAtCursor("up", "abc", 0)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 3)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 1)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 1)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", "", 0)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "", 0)).toBe(true)

    expect(canNavigateHistoryAtCursor("up", "abc", 0, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 3, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "abc", 0, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "abc", 3, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 1, true)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 1, true)).toBe(false)
  })
})
