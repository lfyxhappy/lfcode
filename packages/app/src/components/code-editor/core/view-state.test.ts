import { describe, expect, test } from "bun:test"
import { loadCodeEditorViewState, saveCodeEditorViewState } from "./view-state"

describe("code editor view state store", () => {
  test("stores and reloads view state by path", () => {
    const state = { contributionsState: {}, cursorState: [], viewState: {} } as any
    saveCodeEditorViewState("C:\\Demo\\main.tsx", state)
    expect(loadCodeEditorViewState("c:\\demo\\main.tsx")).toBe(state)
  })

  test("keeps only the most recent entries", () => {
    for (let index = 0; index < 30; index += 1) {
      saveCodeEditorViewState(`C:\\demo\\file-${index}.ts`, { viewState: index } as any)
    }

    expect(loadCodeEditorViewState("C:\\demo\\file-0.ts")).toBeUndefined()
    expect(loadCodeEditorViewState("C:\\demo\\file-29.ts")).toBeDefined()
  })
})
