import { describe, expect, test } from "bun:test"
import { isRenameDoubleClick, RENAME_DOUBLE_CLICK_WINDOW_MS } from "./rename-double-click"

describe("rename double-click detection", () => {
  test("accepts a compact consecutive click pair", () => {
    expect(isRenameDoubleClick(100, 100 + RENAME_DOUBLE_CLICK_WINDOW_MS)).toBe(true)
  })

  test("rejects ordinary separated clicks", () => {
    expect(isRenameDoubleClick(100, 100 + RENAME_DOUBLE_CLICK_WINDOW_MS + 1)).toBe(false)
  })

  test("rejects a clock reversal", () => {
    expect(isRenameDoubleClick(100, 99)).toBe(false)
  })
})
