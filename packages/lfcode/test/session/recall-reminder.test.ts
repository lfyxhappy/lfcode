import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

describe("recall reminder", () => {
  test("does not inject an automatic session/task/actor/memory recall instruction", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/session/prompt.ts"), "utf8")

    expect(source).not.toContain("This session may already have recorded state.")
    expect(source).not.toContain("Before asking the user to repeat prior context")
    expect(source).not.toContain("memoryHint")
  })
})
