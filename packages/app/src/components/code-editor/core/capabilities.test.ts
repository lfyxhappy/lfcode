import { describe, expect, test } from "bun:test"
import { getCodeEditorCapabilities } from "./capabilities"

describe("code editor capabilities", () => {
  test("returns sidebar-full preset", () => {
    const result = getCodeEditorCapabilities("sidebar-full")
    expect(result.showStatusBar).toBe(true)
    expect(result.options.lineNumbers).toBe("on")
    expect(result.options.folding).toBe(true)
    expect(result.options.fontSize).toBe(13)
  })

  test("returns inline-mini preset", () => {
    const result = getCodeEditorCapabilities("inline-mini")
    expect(result.showStatusBar).toBe(false)
    expect(result.options.lineNumbers).toBe("off")
    expect(result.options.folding).toBe(false)
    expect(result.options.fontSize).toBe(12)
  })
})
