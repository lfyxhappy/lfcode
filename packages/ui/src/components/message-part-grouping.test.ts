import { describe, expect, test } from "bun:test"
import type { Part as PartType } from "@lfcode-ai/sdk/v2"
import {
  groupAnchorMessageIDs,
  groupParts,
  isContextGroupTool,
  partDefaultOpen,
  renderable,
  sameGroups,
  toolDefaultOpen,
} from "./message-part-grouping"

function textPart(id: string, text: string): PartType {
  return {
    id,
    sessionID: "s",
    messageID: "m",
    type: "text",
    text,
  }
}

function reasoningPart(id: string, text: string): PartType {
  return {
    id,
    sessionID: "s",
    messageID: "m",
    type: "reasoning",
    text,
    time: { start: 0 },
  }
}

function completedToolPart(id: string, tool: string): PartType {
  return {
    id,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: "c1",
    tool,
    state: {
      status: "completed",
      input: {},
      output: "",
      title: tool,
      metadata: {},
      time: { start: 0, end: 1 },
    },
  }
}

function runningToolPart(id: string, tool: string): PartType {
  return {
    id,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: "c1",
    tool,
    state: {
      status: "running",
      input: {},
      time: { start: 0 },
    },
  }
}

function errorToolPart(id: string, tool: string, error: string): PartType {
  return {
    id,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: `c-${id}`,
    tool,
    state: {
      status: "error",
      input: {},
      error,
      time: { start: 0, end: 1 },
    },
  }
}

describe("message-part-grouping", () => {
  test("groups adjacent context tools into one context entry", () => {
    const grouped = groupParts([
      { messageID: "m1", part: completedToolPart("p1", "read") },
      { messageID: "m1", part: completedToolPart("p2", "glob") },
      { messageID: "m1", part: textPart("p3", "done") },
      { messageID: "m2", part: completedToolPart("p4", "grep") },
    ])

    expect(grouped).toEqual([
      {
        key: "context:p1",
        type: "context",
        refs: [
          { messageID: "m1", partID: "p1" },
          { messageID: "m1", partID: "p2" },
        ],
      },
      {
        key: "part:m1:p3",
        type: "part",
        ref: { messageID: "m1", partID: "p3" },
      },
      {
        key: "context:p4",
        type: "context",
        refs: [{ messageID: "m2", partID: "p4" }],
      },
    ])
  })

  test("compares grouped entries structurally", () => {
    const left = groupParts([
      { messageID: "m1", part: completedToolPart("p1", "read") },
      { messageID: "m1", part: textPart("p2", "done") },
    ])
    const right = groupParts([
      { messageID: "m1", part: completedToolPart("p1", "read") },
      { messageID: "m1", part: textPart("p2", "done") },
    ])

    expect(sameGroups(left, right)).toBe(true)
    expect(
      sameGroups(left, [
        {
          key: "part:m1:p2",
          type: "part",
          ref: { messageID: "m1", partID: "p2" },
        },
      ]),
    ).toBe(false)
  })

  test("groups consecutive duplicate tool failures and keeps the last diagnostic", () => {
    const grouped = groupParts([
      { messageID: "m1", part: errorToolPart("p1", "task", "Error: schema: operation.id is not allowed") },
      { messageID: "m1", part: errorToolPart("p2", "task", "schema:   operation.id is not allowed") },
      { messageID: "m1", part: errorToolPart("p3", "task", "schema: summary is required") },
    ])

    expect(grouped).toEqual([
      {
        key: "tool-error:p1",
        type: "tool-error",
        refs: [
          { messageID: "m1", partID: "p1" },
          { messageID: "m1", partID: "p2" },
        ],
      },
      {
        key: "tool-error:p3",
        type: "tool-error",
        refs: [{ messageID: "m1", partID: "p3" }],
      },
    ])
    expect(groupAnchorMessageIDs(grouped)).toEqual([["m1"], []])
  })

  test("assigns anchor ids to the first group that renders each message", () => {
    const groups = groupParts([
      { messageID: "assistant-1", part: completedToolPart("p1", "read") },
      { messageID: "assistant-1", part: completedToolPart("p2", "glob") },
      { messageID: "assistant-2", part: textPart("p3", "reply") },
      { messageID: "assistant-2", part: completedToolPart("p4", "grep") },
      { messageID: "assistant-1", part: textPart("p5", "follow-up") },
    ])

    expect(groupAnchorMessageIDs(groups)).toEqual([
      ["assistant-1"],
      ["assistant-2"],
      [],
      [],
    ])
  })

  test("filters hidden and incomplete parts", () => {
    expect(renderable(textPart("p1", "hello"))).toBe(true)
    expect(renderable(textPart("p2", "   "))).toBe(false)
    expect(renderable(reasoningPart("p3", "thinking"), false)).toBe(false)
    expect(renderable(completedToolPart("p4", "todowrite"))).toBe(false)
    expect(renderable(runningToolPart("p5", "question"))).toBe(false)
    expect(renderable(completedToolPart("p6", "question"))).toBe(true)
  })

  test("keeps context grouping and default open rules explicit", () => {
    const read = completedToolPart("p1", "read")
    const bash = completedToolPart("p2", "bash")
    const edit = completedToolPart("p3", "edit")

    expect(isContextGroupTool(read)).toBe(true)
    expect(isContextGroupTool(bash)).toBe(false)
    expect(toolDefaultOpen("bash", true, false)).toBe(true)
    expect(toolDefaultOpen("edit", false, true)).toBe(true)
    expect(partDefaultOpen(edit, false, true)).toBe(true)
    expect(partDefaultOpen(read, true, true)).toBeUndefined()
  })
})
