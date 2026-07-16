import { describe, expect, test } from "bun:test"
import { messageIdFromHash } from "./message-id-from-hash"
import { messageHashTargetId } from "./session-hash-target"

describe("messageIdFromHash", () => {
  test("parses hash with leading #", () => {
    expect(messageIdFromHash("#message-abc123")).toBe("abc123")
  })

  test("parses raw hash fragment", () => {
    expect(messageIdFromHash("message-42")).toBe("42")
  })

  test("ignores non-message anchors", () => {
    expect(messageIdFromHash("#review-panel")).toBeUndefined()
  })
})

describe("messageHashTargetId", () => {
  test("keeps user message ids as hash targets", () => {
    expect(
      messageHashTargetId({
        id: "user-1",
        role: "user",
      }),
    ).toBe("user-1")
  })

  test("maps assistant hashes to their parent user turn", () => {
    expect(
      messageHashTargetId({
        id: "assistant-1",
        role: "assistant",
        parentID: "user-1",
      }),
    ).toBe("user-1")
  })

  test("falls back to assistant id when parent id is missing", () => {
    expect(
      messageHashTargetId({
        id: "assistant-1",
        role: "assistant",
      }),
    ).toBe("assistant-1")
  })
})
