import { describe, expect, test } from "bun:test"
import { recentPromptPaths } from "./recent-paths"

describe("prompt-input recent paths", () => {
  test("moves active tab to the front and deduplicates resolved paths", () => {
    const paths = recentPromptPaths(
      ["file://src/a.ts", "file://src/b.ts", "file://src/a.ts"],
      "file://src/b.ts",
      (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
    )

    expect(paths).toEqual(["src/b.ts", "src/a.ts"])
  })

  test("ignores tabs that do not resolve to file paths", () => {
    const paths = recentPromptPaths(
      ["review", "file://src/a.ts", "browser://1"],
      undefined,
      (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
    )

    expect(paths).toEqual(["src/a.ts"])
  })
})
