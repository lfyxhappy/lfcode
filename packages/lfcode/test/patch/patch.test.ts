import { describe, expect, test } from "bun:test"
import { Patch } from "../../src/patch"

describe("Patch parser", () => {
  test("parses structured multi-file edits without exposing a command executor", () => {
    const result = Patch.parsePatch(`*** Begin Patch
*** Add File: test.txt
+Hello World
*** Update File: existing.txt
@@
 old line
-old line
+updated line
*** Delete File: stale.txt
*** End Patch`)

    expect(result.hunks).toHaveLength(3)
    expect(result.hunks.map((hunk) => [hunk.type, hunk.path])).toEqual([
      ["add", "test.txt"],
      ["update", "existing.txt"],
      ["delete", "stale.txt"],
    ])
  })

  test("rejects malformed patch text", () => {
    expect(() => Patch.parsePatch("not a patch")).toThrow("Invalid patch format")
  })
})
