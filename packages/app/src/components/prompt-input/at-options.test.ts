import { describe, expect, test } from "bun:test"
import { buildPromptAtOptions } from "./at-options"

describe("prompt-input at options helper", () => {
  test("keeps recent paths pinned and deduplicates search results", () => {
    expect(buildPromptAtOptions(["src/a.ts", "src/b.ts"], "src", ["src/b.ts", "src/c.ts"])).toEqual([
      { path: "src/a.ts", display: "src/a.ts", recent: true },
      { path: "src/b.ts", display: "src/b.ts", recent: true },
      { path: "src/c.ts", display: "src/c.ts" },
    ])
  })

  test("returns only recent entries for empty queries", () => {
    expect(buildPromptAtOptions(["src/a.ts"], "   ", ["src/c.ts"])).toEqual([
      { path: "src/a.ts", display: "src/a.ts", recent: true },
    ])
  })
})
