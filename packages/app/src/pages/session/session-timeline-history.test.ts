import { describe, expect, test } from "bun:test"
import type { Message, UserMessage } from "@lfcode-ai/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import {
  createSessionHistoryWindow,
  createSessionTimelineMessageSource,
  retainTimelineMessages,
  shiftSessionHistoryTurnStartForPrepend,
} from "./session-timeline-history"

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
        partsByMessageID: () => ({}),
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

  test("uses only real user messages as navigation turns", () => {
    createRoot((dispose) => {
      const [viewAgentID] = createSignal("main")
      const messages = [user("session-a", "user-real"), user("session-a", "user-system")]
      const source = createSessionTimelineMessageSource({
        sessionID: "session-a",
        messages: () => messages,
        partsByMessageID: () => ({
          "user-real": [{ id: "part-real", messageID: "user-real", sessionID: "session-a", type: "text", text: "hello" }],
          "user-system": [
            {
              id: "part-system",
              messageID: "user-system",
              sessionID: "session-a",
              type: "text",
              synthetic: true,
              text: "<system-reminder>continue</system-reminder>",
            },
          ],
        }),
        revertMessageID: () => undefined,
        viewAgentID,
      })

      expect(source.visibleUserMessages().map((message) => message.id)).toEqual(["user-real"])
      dispose()
    })
  })

  test("keeps the last confirmed projection while a refresh has no message page", () => {
    const previous = [user("session-a", "user-a")]
    expect(retainTimelineMessages(undefined, previous)).toEqual(previous)
    expect(retainTimelineMessages([], previous)).toEqual([])
  })
})

describe("createSessionHistoryWindow", () => {
  test("shifts the window start by prepended turns to keep the reading anchor", async () => {
    expect(shiftSessionHistoryTurnStartForPrepend(4, 3)).toBe(7)
    expect(shiftSessionHistoryTurnStartForPrepend(-2, 3)).toBe(3)

    const surface = createRoot((dispose) => {
      const initial = Array.from({ length: 30 }, (_, index) => user("session-a", `user-${index}`))
      const older = Array.from({ length: 4 }, (_, index) => user("session-a", `older-${index}`))
      const [users, setUsers] = createSignal(initial)
      const [more, setMore] = createSignal(true)
      const history = createSessionHistoryWindow({
        sessionID: () => "session-a",
        messagesReady: () => true,
        loaded: () => users().length,
        visibleUserMessages: users,
        historyMore: more,
        historyLoading: () => false,
        loadMore: async () => {
          setUsers([...older, ...users()])
          setMore(false)
        },
        userScrolled: () => false,
        scroller: () => undefined,
        storedTurnStart: () => undefined,
        setStoredTurnStart: () => {},
      })
      history.setTurnStart(10)
      return { dispose, history }
    })

    await surface.history.loadForRestore()
    expect(surface.history.turnStart()).toBe(2)
    expect(surface.history.renderedUserMessages().some((message) => message.id === "user-10")).toBe(true)
    surface.dispose()
  })

  test("stops a history request when the backend page makes no progress", async () => {
    const surface = createRoot((dispose) => {
      let calls = 0
      const users = [user("session-a", "user-0"), user("session-a", "user-1")]
      const history = createSessionHistoryWindow({
        sessionID: () => "session-a",
        messagesReady: () => true,
        loaded: () => users.length,
        visibleUserMessages: () => users,
        historyMore: () => true,
        historyLoading: () => false,
        loadMore: async () => {
          calls += 1
        },
        userScrolled: () => false,
        scroller: () => undefined,
        storedTurnStart: () => undefined,
        setStoredTurnStart: () => {},
      })
      history.setTurnStart(1)
      return { dispose, history, calls: () => calls }
    })

    await surface.history.loadForRestore()
    expect(surface.calls()).toBe(1)
    expect(surface.history.turnStart()).toBe(1)
    surface.dispose()
  })
})
