import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { promptSlashSelectionResult } from "./slash-selection"

describe("prompt-input slash selection helper", () => {
  test("builds a text prompt for custom slash commands", () => {
    const result = promptSlashSelectionResult(
      {
        id: "custom.ship",
        trigger: "ship",
        title: "ship",
        type: "custom",
      },
      [{ type: "text", content: "", start: 0, end: 0 }] satisfies Prompt,
      [],
    )

    expect(result).toEqual({
      kind: "custom",
      text: "/ship ",
      prompt: [{ type: "text", content: "/ship ", start: 0, end: 6 }],
      cursor: 6,
    })
  })

  test("resets to the empty prompt and preserves images for builtin commands", () => {
    const result = promptSlashSelectionResult(
      {
        id: "fix",
        trigger: "fix",
        title: "Fix",
        type: "builtin",
      },
      [{ type: "text", content: "", start: 0, end: 0 }] satisfies Prompt,
      [{ type: "image", id: "img-1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,abc" }],
    )

    expect(result).toEqual({
      kind: "builtin",
      commandID: "fix",
      prompt: [
        { type: "text", content: "", start: 0, end: 0 },
        { type: "image", id: "img-1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,abc" },
      ],
    })
  })
})
