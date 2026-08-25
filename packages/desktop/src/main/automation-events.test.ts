import { describe, expect, test } from "bun:test"
import { createAutomationEventBuffer } from "./automation-events"

describe("createAutomationEventBuffer", () => {
  test("keeps newest events within the limit", () => {
    const events = createAutomationEventBuffer(2)
    events.push({ scope: "server", type: "request" })
    events.push({ scope: "server", type: "response" })
    events.push({ scope: "renderer", type: "route.changed" })
    expect(events.list().map((item) => item.type)).toEqual(["response", "route.changed"])
  })

  test("filters by scope and type", () => {
    const events = createAutomationEventBuffer()
    events.push({ scope: "server", type: "request" })
    events.push({ scope: "server", type: "response" })
    events.push({ scope: "renderer", type: "request" })
    expect(events.list({ scope: "server" }).map((item) => item.type)).toEqual(["request", "response"])
    expect(events.list({ type: "request" }).map((item) => item.scope)).toEqual(["server", "renderer"])
  })

  test("reports cursor resets without changing the legacy event shape", () => {
    const events = createAutomationEventBuffer(2)
    events.push({ scope: "server", type: "request" })
    events.push({ scope: "server", type: "response" })
    const newest = events.push({ scope: "renderer", type: "route.changed" })

    const result = events.next({ after: 0 })
    expect(result).toMatchObject({
      oldestID: 2,
      latestID: 3,
      nextCursor: 3,
      resetRequired: false,
    })
    expect(result.events.map((event) => event.id)).toEqual([2, 3])
    expect(newest.timestamp).toBe(newest.at)
    expect(typeof newest.isoTime).toBe("string")
    expect(typeof newest.at).toBe("number")

    events.push({ scope: "main", type: "window.focus-main" })
    const reset = events.next({ after: 1 })
    expect(reset).toMatchObject({
      oldestID: 3,
      latestID: 4,
      resetRequired: true,
    })
    expect(reset.events.map((event) => event.id)).toEqual([3, 4])
    expect(events.next({ after: 2, limit: 1 }).nextCursor).toBe(3)
  })

  test("waits for matching events and removes cancelled waiters", async () => {
    const events = createAutomationEventBuffer()
    const waiting = events.wait({ after: 0, scope: "renderer", waitMs: 1_000 })
    expect(events.pendingWaiterCount()).toBe(1)

    events.push({ scope: "server", type: "request" })
    expect(events.pendingWaiterCount()).toBe(1)
    events.push({ scope: "renderer", type: "route.changed" })

    await expect(waiting).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "route.changed" })],
      nextCursor: 2,
    })
    expect(events.pendingWaiterCount()).toBe(0)

    const controller = new AbortController()
    const cancelled = events.wait({ after: 2, waitMs: 1_000, signal: controller.signal })
    expect(events.pendingWaiterCount()).toBe(1)
    controller.abort()
    await expect(cancelled).resolves.toMatchObject({ events: [], nextCursor: 2 })
    expect(events.pendingWaiterCount()).toBe(0)
  })
})
