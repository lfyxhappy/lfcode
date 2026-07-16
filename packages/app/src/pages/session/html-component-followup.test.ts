import { describe, expect, test } from "bun:test"
import { buildHtmlComponentFollowupDraft, formatHtmlComponentFollowup } from "./html-component-followup"

describe("formatHtmlComponentFollowup", () => {
  test("formats payload and state into a readable followup message", () => {
    expect(
      formatHtmlComponentFollowup({
        componentID: "component-1",
        title: "五子棋",
        event: "place_stone",
        payload: { x: 7, y: 8, color: "black" },
        state: { next: "white" },
      }),
    ).toBe(
      [
        "[组件交互: 五子棋]",
        "event: place_stone",
        'payload: {"x":7,"y":8,"color":"black"}',
        'state: {"next":"white"}',
      ].join("\n"),
    )
  })
})

describe("buildHtmlComponentFollowupDraft", () => {
  test("builds a followup draft that reuses the current session routing", () => {
    const content = [
      "[组件交互: Chooser]",
      "event: pick_option",
      'payload: {"value":"A"}',
      'state: {"selected":"A"}',
    ].join("\n")
    const draft = buildHtmlComponentFollowupDraft(
      {
        componentID: "component-1",
        title: "Chooser",
        event: "pick_option",
        payload: { value: "A" },
        state: { selected: "A" },
      },
      {
        sessionID: "session-1",
        sessionDirectory: "C:/workspace",
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "high",
      },
    )

    expect(draft).toMatchObject({
      sessionID: "session-1",
      sessionDirectory: "C:/workspace",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
      context: [],
    })
    expect(draft.prompt).toEqual([
      {
        type: "text",
        content,
        start: 0,
        end: content.length,
      },
    ])
  })
})
