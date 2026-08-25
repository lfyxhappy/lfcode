import { describe, expect, test } from "bun:test"
import { normalizeTavernAuthorNote, renderTavernAuthorNote } from "./tavern-author-note"

describe("Tavern author note", () => {
  test("normalizes a bounded, non-empty session note", () => {
    expect(normalizeTavernAuthorNote({ content: "  保持雨夜的压抑氛围。  " })).toEqual({ content: "保持雨夜的压抑氛围。" })
    expect(normalizeTavernAuthorNote({ content: "   " })).toBeUndefined()
    expect(normalizeTavernAuthorNote(undefined)).toBeUndefined()
  })

  test("renders after macro expansion without inventing an active note", () => {
    expect(renderTavernAuthorNote({ content: "{{char}} 不应离开码头。" }, (value) => value.replace("{{char}}", "艾达"))).toBe("作者注释：\n艾达 不应离开码头。")
    expect(renderTavernAuthorNote(undefined)).toBeUndefined()
  })
})
