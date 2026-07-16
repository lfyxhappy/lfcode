import { describe, expect, test } from "bun:test"
import { isCodeEditorPhase0Enabled, isCodeEditorPhase0Path } from "./phase0"

describe("code editor phase0 helpers", () => {
  test("detects supported phase0 files", () => {
    expect(isCodeEditorPhase0Path("C:\\demo\\main.tsx")).toBe(true)
    expect(isCodeEditorPhase0Path("C:\\demo\\main.cpp")).toBe(true)
    expect(isCodeEditorPhase0Path("C:\\demo\\script.ps1")).toBe(true)
    expect(isCodeEditorPhase0Path("C:\\demo\\config.yaml")).toBe(true)
    expect(isCodeEditorPhase0Path("C:\\demo\\notes.txt")).toBe(true)
  })

  test("ignores unsupported files", () => {
    expect(isCodeEditorPhase0Path("C:\\demo\\image.bin")).toBe(false)
  })

  test("returns a boolean enablement state", () => {
    expect(typeof isCodeEditorPhase0Enabled()).toBe("boolean")
  })
})
