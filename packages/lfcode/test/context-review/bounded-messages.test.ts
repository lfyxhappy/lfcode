import { describe, expect, test } from "bun:test"
import { boundedContextReviewMessages } from "../../src/context-review/bounded-messages"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"

function message(id: string, role: "user" | "assistant", agentID?: string) {
  return { info: { id, role, agentID }, parts: [] } as unknown as MessageV2.WithParts
}

describe("boundedContextReviewMessages", () => {
  test("keeps the current primary user and assistant while excluding child agents", () => {
    const result = boundedContextReviewMessages(
      [message("u1", "user", "main"), message("child", "assistant", "general-1"), message("u2", "user", "main"), message("a2", "assistant", "main")],
      MessageID.make("u2"),
      MessageID.make("a2"),
    )
    expect(result.map((item) => String(item.info.id))).toEqual(["u1", "u2", "a2"])
  })

  test("bounds the slice to the most recent primary messages", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${String(index).padStart(2, "0")}`, "user", "main"))
    const result = boundedContextReviewMessages(messages, MessageID.make("m39"), MessageID.make("missing"))
    expect(result).toHaveLength(24)
    expect(String(result[0]?.info.id)).toBe("m16")
  })
})
