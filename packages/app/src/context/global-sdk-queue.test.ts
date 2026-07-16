import { describe, expect, test } from "bun:test"
import type { Event } from "@lfcode-ai/sdk/v2/client"
import { queueGlobalSdkEvent } from "./global-sdk-queue"

const textPartUpdated = (text: string) =>
  ({
    type: "message.part.updated",
    properties: {
      sessionID: "ses_1",
      time: Date.now(),
      part: {
        id: "prt_1",
        messageID: "msg_1",
        sessionID: "ses_1",
        type: "text",
        text,
      },
    },
  }) as Event

const textPartDelta = (delta: string) =>
  ({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta,
    },
  }) as Event

describe("queueGlobalSdkEvent", () => {
  test("preserves start updated, deltas, and final updated in the same frame", () => {
    const queue: { directory: string; payload: Event }[] = []
    const coalesced = new Map<string, { index: number; deltaSeq: number }>()
    const deltaSeq = new Map<string, number>()

    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartDelta("你") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartDelta("好") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("你好") })

    expect(queue.map((item) => item.payload.type)).toEqual([
      "message.part.updated",
      "message.part.delta",
      "message.part.delta",
      "message.part.updated",
    ])
    const first = queue[0]?.payload
    const last = queue[3]?.payload
    if (first?.type === "message.part.updated" && first.properties.part.type === "text") expect(first.properties.part.text).toBe("")
    if (last?.type === "message.part.updated" && last.properties.part.type === "text") expect(last.properties.part.text).toBe("你好")
  })

  test("coalesces repeated part updated events before deltas start", () => {
    const queue: { directory: string; payload: Event }[] = []
    const coalesced = new Map<string, { index: number; deltaSeq: number }>()
    const deltaSeq = new Map<string, number>()

    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("预热") })

    expect(queue).toHaveLength(1)
    const only = queue[0]?.payload
    if (only?.type === "message.part.updated" && only.properties.part.type === "text") expect(only.properties.part.text).toBe("预热")
  })

  test("coalesces only terminal updated events after deltas", () => {
    const queue: { directory: string; payload: Event }[] = []
    const coalesced = new Map<string, { index: number; deltaSeq: number }>()
    const deltaSeq = new Map<string, number>()

    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartDelta("a") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("a") })
    queueGlobalSdkEvent({ queue, coalesced, deltaSeq, directory: "/tmp", payload: textPartUpdated("ab") })

    expect(queue.map((item) => item.payload.type)).toEqual([
      "message.part.updated",
      "message.part.delta",
      "message.part.updated",
    ])
    const last = queue[2]?.payload
    if (last?.type === "message.part.updated" && last.properties.part.type === "text") expect(last.properties.part.text).toBe("ab")
  })

  test("still coalesces session status updates", () => {
    const queue: { directory: string; payload: Event }[] = []
    const coalesced = new Map<string, { index: number; deltaSeq: number }>()
    const deltaSeq = new Map<string, number>()

    queueGlobalSdkEvent({
      queue,
      coalesced,
      deltaSeq,
      directory: "/tmp",
      payload: { type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } } as Event,
    })
    queueGlobalSdkEvent({
      queue,
      coalesced,
      deltaSeq,
      directory: "/tmp",
      payload: { type: "session.status", properties: { sessionID: "ses_1", status: { type: "idle" } } } as Event,
    })

    expect(queue).toHaveLength(1)
    const only = queue[0]?.payload
    if (only?.type === "session.status") expect(only.properties.status.type).toBe("idle")
  })
})
