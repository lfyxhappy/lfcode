import { describe, expect, test } from "bun:test"
import { normalizeToolError } from "./tool-error-normalize"

describe("normalizeToolError", () => {
  test("hides the legacy invalid placeholder while preserving the real tool name", () => {
    expect(normalizeToolError("run_code", "Model tried to call unavailable tool 'invalid'.")).toBe(
      "工具 run_code 的参数不完整，无法解析。请重新生成有效的工具参数。",
    )
  })

  test("leaves current errors unchanged", () => {
    expect(normalizeToolError("run_code", "run_code was called with invalid arguments")).toBe(
      "run_code was called with invalid arguments",
    )
  })
})
