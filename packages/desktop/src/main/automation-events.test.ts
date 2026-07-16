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
})
