import { describe, expect, test } from "bun:test"
import {
  createAssistantActivityRevision,
  createTimelineViewportSnapshot,
  getAnchorRestoreTop,
  shouldRestoreViewportSnapshot,
} from "./scroll-snapshot"

describe("createTimelineViewportSnapshot", () => {
  test("stores a bottom snapshot near the end of the timeline", () => {
    expect(
      createTimelineViewportSnapshot({
        scrollTop: 798,
        scrollHeight: 1000,
        clientHeight: 200,
        assistantRevision: "assistant-1\nidle",
        historyTurnStart: 8,
        now: 123,
      }),
    ).toEqual({
      version: 3,
      mode: "bottom",
      assistantRevision: "assistant-1\nidle",
      historyTurnStart: 8,
      updatedAt: 123,
    })
  })

  test("stores a visible render block rather than a message placeholder", () => {
    expect(
      createTimelineViewportSnapshot({
        scrollTop: 320,
        scrollHeight: 2000,
        clientHeight: 600,
        anchorBlockId: "msg-1:part-2",
        anchorTurnId: "msg-user-1",
        anchorTop: 240,
        viewportTop: 100,
        assistantRevision: "assistant-2\nidle",
        historyTurnStart: 4,
        now: 123,
      }),
    ).toEqual({
      version: 3,
      mode: "anchor",
      assistantRevision: "assistant-2\nidle",
      historyTurnStart: 4,
      anchorBlockId: "msg-1:part-2",
      anchorTurnId: "msg-user-1",
      anchorOffsetPx: 140,
      updatedAt: 123,
    })
  })
})

describe("assistant activity revision", () => {
  test("ignores user-only session updates but tracks assistant output and streaming", () => {
    const idle = createAssistantActivityRevision({ assistantMessageId: "msg-2", streaming: false })
    expect(createAssistantActivityRevision({ assistantMessageId: "msg-2", streaming: false })).toBe(idle)
    expect(createAssistantActivityRevision({ assistantMessageId: "msg-3", streaming: false })).not.toBe(idle)
    expect(createAssistantActivityRevision({ assistantMessageId: "msg-2", streaming: true })).not.toBe(idle)
  })

  test("does not restore an anchor while a new assistant reply exists", () => {
    const snapshot = createTimelineViewportSnapshot({
      scrollTop: 200,
      scrollHeight: 1200,
      clientHeight: 400,
      anchorBlockId: "msg-1:part-1",
      anchorTurnId: "user-1",
      anchorTop: 140,
      viewportTop: 0,
      assistantRevision: "assistant-1\nidle",
      historyTurnStart: 2,
      now: 1,
    })
    expect(
      shouldRestoreViewportSnapshot({
        snapshot,
        assistantRevision: "assistant-2\nidle",
        streaming: false,
      }),
    ).toBe(false)
  })
})

describe("getAnchorRestoreTop", () => {
  test("restores a semantic anchor to its previous viewport offset", () => {
    expect(
      getAnchorRestoreTop({
        currentScrollTop: 500,
        currentAnchorTop: 220,
        viewportTop: 100,
        anchorOffsetPx: 80,
      }),
    ).toBe(540)
  })
})
