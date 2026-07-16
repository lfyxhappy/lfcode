import { describe, expect, test } from "bun:test"
import { promptHistoryCursor, shouldResetPromptHistoryNavigation } from "./history-state"

describe("prompt-input history state helpers", () => {
  test("computes the target cursor for restored history prompts", () => {
    expect(promptHistoryCursor("start", 12)).toBe(0)
    expect(promptHistoryCursor("end", 12)).toBe(12)
  })

  test("only resets history navigation when needed", () => {
    expect(shouldResetPromptHistoryNavigation({ historyIndex: -1, applyingHistory: false })).toBe(false)
    expect(shouldResetPromptHistoryNavigation({ historyIndex: 0, applyingHistory: true })).toBe(false)
    expect(shouldResetPromptHistoryNavigation({ historyIndex: 0, applyingHistory: false })).toBe(true)
    expect(shouldResetPromptHistoryNavigation({ force: true, historyIndex: -1, applyingHistory: true })).toBe(true)
  })
})
