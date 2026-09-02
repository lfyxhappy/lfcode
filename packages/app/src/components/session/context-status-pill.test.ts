import { describe, expect, test } from "bun:test"
import { contextStatusTone, formatContextStatusTokens, isCurrentContextStatusRequest } from "./context-status-state"

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
    expect(formatContextStatusTokens(1_250, "zh-CN")).toBe("1.3K")
  })

  test("only accepts the newest response when a session is refreshed repeatedly", () => {
    const earlier = { sessionID: "ses_test", directory: "C:/work", generation: 4 }
    const later = { sessionID: "ses_test", directory: "C:/work", generation: 5 }

    expect(isCurrentContextStatusRequest(earlier, later.generation)).toBe(false)
    expect(isCurrentContextStatusRequest(later, later.generation)).toBe(true)
  })
})
