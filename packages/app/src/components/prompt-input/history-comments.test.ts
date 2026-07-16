import { describe, expect, test } from "bun:test"
import type { LineComment } from "@/context/comments"
import type { FileContextItem } from "@/context/prompt"
import { collectPromptHistoryComments, restorePromptHistoryComments } from "./history-comments"

describe("prompt-input history comment helpers", () => {
  test("collects trimmed comments and prefers live comment selection/time", () => {
    const items = [
      {
        type: "file",
        key: "ctx-1",
        path: "src/app.ts",
        comment: "  fix this  ",
        commentID: "comment-1",
        commentOrigin: "review",
        preview: "const value = 1",
        selection: { startLine: 2, startChar: 1, endLine: 4, endChar: 1 },
      },
    ] satisfies (FileContextItem & { key: string })[]
    const comments = [
      {
        id: "comment-1",
        file: "src/app.ts",
        selection: { start: 8, end: 9 },
        comment: "older",
        time: 42,
      },
    ] satisfies LineComment[]

    expect(collectPromptHistoryComments(items, comments, () => 99)).toEqual([
      {
        id: "comment-1",
        path: "src/app.ts",
        selection: { start: 8, end: 9 },
        comment: "fix this",
        time: 42,
        origin: "review",
        preview: "const value = 1",
      },
    ])
  })

  test("falls back to context selection and generated time for draft comments", () => {
    const items = [
      {
        type: "file",
        key: "draft-1",
        path: "src/app.ts",
        comment: "note",
        selection: { startLine: 3, startChar: 1, endLine: 5, endChar: 1 },
      },
    ] satisfies (FileContextItem & { key: string })[]

    expect(collectPromptHistoryComments(items, [], () => 77)).toEqual([
      {
        id: "draft-1",
        path: "src/app.ts",
        selection: { start: 3, end: 5 },
        comment: "note",
        time: 77,
        origin: undefined,
        preview: undefined,
      },
    ])
  })

  test("ignores items without comment text or line selection", () => {
    const items = [
      {
        type: "file",
        key: "empty",
        path: "src/app.ts",
        comment: "   ",
        selection: { startLine: 1, startChar: 1, endLine: 1, endChar: 1 },
      },
      {
        type: "file",
        key: "no-selection",
        path: "src/other.ts",
        comment: "note",
      },
    ] satisfies (FileContextItem & { key: string })[]

    expect(collectPromptHistoryComments(items, [], () => 1)).toEqual([])
  })

  test("restores history comments into comment store and prompt context payloads", () => {
    const restored = restorePromptHistoryComments([
      {
        id: "comment-1",
        path: "src/app.ts",
        selection: { start: 6, end: 7 },
        comment: "check this",
        time: 55,
        origin: "file",
        preview: "line preview",
      },
    ])

    expect(restored.comments).toEqual([
      {
        id: "comment-1",
        file: "src/app.ts",
        selection: { start: 6, end: 7 },
        comment: "check this",
        time: 55,
      },
    ])
    expect(restored.contextItems).toEqual([
      {
        type: "file",
        path: "src/app.ts",
        selection: { startLine: 6, startChar: 0, endLine: 7, endChar: 0 },
        comment: "check this",
        commentID: "comment-1",
        commentOrigin: "file",
        preview: "line preview",
      },
    ])
  })
})
