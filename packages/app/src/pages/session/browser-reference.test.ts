import { describe, expect, test } from "bun:test"
import { appendBrowserReferenceToPrompt, buildWebReferenceAttachment } from "./browser-reference"

describe("browser reference helpers", () => {
  test("rejects incomplete references", () => {
    expect(buildWebReferenceAttachment({ text: "hello" })).toBeUndefined()
    expect(buildWebReferenceAttachment({ url: "https://example.com" })).toBeUndefined()
  })

  test("builds a selection reference attachment", () => {
    expect(
      buildWebReferenceAttachment({
        label: "Example Domain",
        text: "This domain is for use in illustrative examples.",
        url: "https://example.com",
        selector: "main p",
        mode: "selection",
      }),
    ).toEqual({
      type: "web-reference",
      label: "Example Domain",
      text: "This domain is for use in illustrative examples.",
      url: "https://example.com",
      title: "Example Domain",
      selector: "main p",
      mode: "selection",
      content: "[web:Example Domain]",
    })
  })

  test("builds an element reference attachment with selector and title fallback", () => {
    expect(
      buildWebReferenceAttachment({
        label: "Example Domain",
        text: "Launch action",
        url: "https://example.com/cta",
        selector: "button.primary",
        mode: "element",
      }),
    ).toEqual({
      type: "web-reference",
      label: "Example Domain",
      text: "Launch action",
      url: "https://example.com/cta",
      title: "Example Domain",
      selector: "button.primary",
      mode: "element",
      content: "[element:Example Domain]",
    })
  })

  test("appends a reference to a non-empty prompt with correct offsets", () => {
    const result = appendBrowserReferenceToPrompt(
      [{ type: "text", content: "请总结一下 ", start: 0, end: 6 }],
      {
        label: "Example Domain",
        text: "This domain is for use in illustrative examples.",
        url: "https://example.com",
        mode: "element",
      },
    )

    expect(result?.cursor).toBe(30)
    expect(result?.attachment).toMatchObject({
      content: "[element:Example Domain]",
      start: 6,
      end: 30,
      mode: "element",
    })
    expect(result?.prompt).toHaveLength(2)
  })

  test("replaces the default blank prompt before appending", () => {
    const result = appendBrowserReferenceToPrompt(
      [{ type: "text", content: "", start: 0, end: 0 }],
      {
        label: "Example Domain",
        text: "This domain is for use in illustrative examples.",
        url: "https://example.com",
      },
    )

    expect(result?.prompt).toHaveLength(1)
    expect(result?.attachment.start).toBe(0)
    expect(result?.attachment.end).toBe("[web:Example Domain]".length)
  })
})
