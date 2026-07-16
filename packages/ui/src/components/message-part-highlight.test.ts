import { describe, expect, test } from "bun:test"
import type { AgentPart, FilePart } from "@lfcode-ai/sdk/v2"
import { buildHighlightSegments } from "./message-part-highlight"

function filePart(start: number, end: number): FilePart {
  return {
    id: "f1",
    sessionID: "s",
    messageID: "m",
    type: "file",
    mime: "text/plain",
    filename: "a.ts",
    url: "file:///a.ts",
    source: {
      type: "file",
      path: "a.ts",
      text: {
        value: "",
        start,
        end,
      },
    },
  }
}

function agentPart(start: number, end: number): AgentPart {
  return {
    id: "a1",
    sessionID: "s",
    messageID: "m",
    type: "agent",
    name: "planner",
    source: { value: "", start, end },
  }
}

describe("message-part-highlight", () => {
  test("builds text and highlighted segments in order", () => {
    expect(buildHighlightSegments("hello @src and $planner", [filePart(6, 10)], [agentPart(15, 23)])).toEqual([
      { text: "hello " },
      { text: "@src", type: "file" },
      { text: " and " },
      { text: "$planner", type: "agent" },
    ])
  })

  test("skips overlapping references and keeps tail text", () => {
    expect(buildHighlightSegments("abcdefghi", [filePart(1, 4), filePart(2, 6)], [agentPart(7, 9)])).toEqual([
      { text: "a" },
      { text: "bcd", type: "file" },
      { text: "efg" },
      { text: "hi", type: "agent" },
    ])
  })
})
