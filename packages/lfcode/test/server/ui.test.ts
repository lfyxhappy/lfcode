import { describe, expect, test } from "bun:test"
import { inlineScriptHash } from "../../src/server/routes/ui"

describe("web UI CSP", () => {
  test("hashes inline scripts after HTML newline normalization", () => {
    expect(inlineScriptHash("const theme = 'light';\r\n")).toBe(inlineScriptHash("const theme = 'light';\n"))
  })
})
