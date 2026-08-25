import { describe, expect, test } from "bun:test"
import { contextStatusTone, formatContextStatusTokens } from "./context-status-state"

describe("ContextStatusPill", () => {
  test("maps each pressure stage to a stable status tone", () => {
    expect(contextStatusTone("idle")).toBe("bg-status-success")
    expect(contextStatusTone("monitoring")).toBe("bg-status-info")
    expect(contextStatusTone("checkpoint")).toBe("bg-status-warning")
    expect(contextStatusTone("rebuild")).toBe("bg-status-error")
  })

  test("formats compact token counts for the header popover", () => {
    expect(formatContextStatusTokens(999, "en")).toBe("999")
    expect(formatContextStatusTokens(1_250, "en")).toBe("1.3K")
  })
})
