import { describe, expect, test } from "bun:test"
import { parseSubagentDeclaredFiles, subagentDispatchDescription } from "./subagent-dispatch-state"

describe("subagent dispatch state", () => {
  test("normalizes declared file paths without breaking paths that contain spaces", () => {
    expect(parseSubagentDeclaredFiles("src/main.ts\n src/components/with spaces.ts,src/main.ts\n")).toEqual([
      "src/main.ts",
      "src/components/with spaces.ts",
    ])
  })

  test("creates a concise dispatch description", () => {
    expect(subagentDispatchDescription("  Review\n  the actor queue  ")).toBe("Review the actor queue")
    expect(subagentDispatchDescription("x".repeat(240))).toHaveLength(160)
  })
})
