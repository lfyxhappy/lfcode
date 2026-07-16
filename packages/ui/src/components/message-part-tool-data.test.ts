import { describe, expect, test } from "bun:test"
import { readDiagnosticsByFile, readDiffChanges, readFileDiff, readString, readStringField } from "./message-part-tool-data"

describe("message-part tool data helpers", () => {
  test("reads string values safely", () => {
    expect(readString("hello")).toBe("hello")
    expect(readString(1)).toBeUndefined()
    expect(readStringField({ path: "/tmp/a.ts" }, "path")).toBe("/tmp/a.ts")
    expect(readStringField({ path: 1 }, "path")).toBeUndefined()
  })

  test("reads diagnostics maps and drops invalid rows", () => {
    expect(
      readDiagnosticsByFile({
        "a.ts": [{ message: "bad", range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } } }],
        "b.ts": [{ message: 1 }],
      }),
    ).toEqual({
      "a.ts": [{ message: "bad", range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } } }],
    })
  })

  test("reads diff payloads safely", () => {
    expect(readDiffChanges({ additions: 2, deletions: 1, ignored: true })).toEqual({ additions: 2, deletions: 1 })
    expect(readFileDiff({ additions: 2, deletions: 1, file: "a.ts", before: "old", after: "new" })).toEqual({
      additions: 2,
      deletions: 1,
      file: "a.ts",
      before: "old",
      after: "new",
    })
    expect(readFileDiff({ additions: "2", deletions: 1 })).toBeUndefined()
  })
})
