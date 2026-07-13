import { describe, expect, test } from "bun:test"
import type { Message, UserMessage } from "@lfcode-ai/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import { createSessionTimelineMessageSource, retainTimelineMessages } from "./session-timeline-history"

function user(sessionID: string, id: string): UserMessage {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
  } as UserMessage
}

describe("createSessionTimelineMessageSource", () => {
  test("keeps a warm surface bound to its original session instead of the active route", () => {
    createRoot((dispose) => {
      const [activeSessionID, setActiveSessionID] = createSignal("session-a")
      const [viewAgentID] = createSignal("main")
      const messages: Record<string, Message[]> = {
        "session-a": [user("session-a", "user-a")],
        "session-b": [user("session-b", "user-b")],
      }
      const source = createSessionTimelineMessageSource({
        sessionID: "session-a",
        messages: (sessionID) => messages[sessionID],
        revertMessageID: () => undefined,
        viewAgentID,
      })

      expect(source.timelineMessages().map((message) => message.id)).toEqual(["user-a"])
      setActiveSessionID("session-b")
      expect(activeSessionID()).toBe("session-b")
      expect(source.timelineMessages().map((message) => message.id)).toEqual(["user-a"])

      dispose()
    })
  })

  test("keeps the last confirmed projection while a refresh has no message page", () => {
    const previous = [user("session-a", "user-a")]
    expect(retainTimelineMessages(undefined, previous)).toEqual(previous)
    expect(retainTimelineMessages([], previous)).toEqual([])
  })
})
