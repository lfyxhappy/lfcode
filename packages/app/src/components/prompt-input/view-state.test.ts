import { describe, expect, test } from "bun:test"
import type { PromptFeature } from "@/utils/prompt-features"
import {
  promptCommentCount,
  promptControlStyle,
  promptFeatureItems,
  promptMotion,
  promptVisibleContextItems,
  sessionHasUserPrompt,
} from "./view-state"

describe("prompt-input view state helpers", () => {
  test("builds prompt motion and control styles deterministically", () => {
    expect(promptMotion(1)).toEqual({
      opacity: 1,
      transform: "scale(1)",
      filter: "blur(0px)",
      "pointer-events": "auto",
    })
    expect(promptControlStyle(0)).toEqual({
      height: "28px",
      opacity: 0,
      transform: "scale(0.95)",
      filter: "blur(2px)",
      "pointer-events": "none",
    })
  })

  test("counts comments and hides them in shell mode", () => {
    const items = [{ comment: " note " }, { comment: " " }, {}]

    expect(promptCommentCount("normal", items)).toBe(1)
    expect(promptCommentCount("shell", items)).toBe(0)
    expect(promptVisibleContextItems("normal", items)).toBe(items)
    expect(promptVisibleContextItems("shell", items)).toEqual([{ comment: " " }, {}])
  })

  test("detects whether the session already has a user prompt", () => {
    expect(sessionHasUserPrompt(undefined)).toBe(false)
    expect(sessionHasUserPrompt([{ role: "assistant" }, { role: "user" }])).toBe(true)
    expect(sessionHasUserPrompt([{ role: "assistant" }])).toBe(false)
  })

  test("maps enabled prompt features into localized menu items", () => {
    const enabled = ["browser-rendering"] satisfies PromptFeature[]
    const items = promptFeatureItems(enabled, (key) => `t:${key}`)

    expect(items).toEqual([
      {
        id: "browser-rendering",
        checked: true,
        label: "t:prompt.feature.browserRendering.label",
        description: "t:prompt.feature.browserRendering.description",
      },
    ])
  })
})
