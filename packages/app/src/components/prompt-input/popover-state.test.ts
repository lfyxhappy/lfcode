import { describe, expect, test } from "bun:test"
import { detectPromptPopover, pickActivePopoverItem } from "./popover-state"

describe("prompt-input popover state helpers", () => {
  test("detects agent, file, and slash popovers in normal mode", () => {
    expect(detectPromptPopover({ mode: "normal", rawText: "$builder", cursorPosition: 8 })).toEqual({
      popover: "agent",
      query: "builder",
    })
    expect(detectPromptPopover({ mode: "normal", rawText: "open @src", cursorPosition: 9 })).toEqual({
      popover: "at",
      query: "src",
    })
    expect(detectPromptPopover({ mode: "normal", rawText: "/plan", cursorPosition: 5 })).toEqual({
      popover: "slash",
      query: "plan",
    })
  })

  test("suppresses popovers in shell mode or when no trigger matches", () => {
    expect(detectPromptPopover({ mode: "shell", rawText: "$builder", cursorPosition: 8 })).toEqual({
      popover: null,
      query: undefined,
    })
    expect(detectPromptPopover({ mode: "normal", rawText: "hello", cursorPosition: 5 })).toEqual({
      popover: null,
      query: undefined,
    })
  })

  test("picks the active item and falls back to the first entry", () => {
    const items = [{ id: "a" }, { id: "b" }]

    expect(pickActivePopoverItem(items, "b", (item) => item.id)).toEqual({ id: "b" })
    expect(pickActivePopoverItem(items, "missing", (item) => item.id)).toEqual({ id: "a" })
    expect(pickActivePopoverItem([], "missing", (item: { id: string }) => item.id)).toBeUndefined()
  })
})
