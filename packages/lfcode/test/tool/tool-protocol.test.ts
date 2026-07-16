import { describe, expect, test } from "bun:test"
import z from "zod"
import {
  contentVersion,
} from "../../src/tool/patch-recovery"
import {
  defaultMetadata,
  formatValidationError,
} from "../../src/tool/tool"

describe("tool protocol", () => {
  test("assigns stable metadata for core tools", () => {
    expect(defaultMetadata("read")).toEqual({
      kind: "file",
      namespace: "file",
      readOnly: true,
      recovery: "reread",
      latencyClass: "io",
    })
    expect(defaultMetadata("apply_patch").readOnly).toBe(false)
    expect(defaultMetadata("task").readOnly).toBe(false)
    expect(defaultMetadata("websearch").latencyClass).toBe("network")
  })

  test("formats schema failures as a structured, actionable error", () => {
    const schema = z.object({ operation: z.object({ action: z.string() }) })
    const result = schema.safeParse({ operation: {} })
    if (result.success) throw new Error("expected schema failure")

    const output = formatValidationError({ tool: "task", error: result.error })
    expect(output).toContain('"type":"tool_error"')
    expect(output).toContain('"category":"schema"')
    expect(output).toContain("operation.action")
    expect(output).toContain("do not repeat the same arguments unchanged")
  })

  test("uses the same content version for the same bytes", () => {
    expect(contentVersion(new TextEncoder().encode("alpha"))).toBe(contentVersion(new TextEncoder().encode("alpha")))
    expect(contentVersion(new TextEncoder().encode("alpha"))).not.toBe(contentVersion(new TextEncoder().encode("beta")))
  })
})
