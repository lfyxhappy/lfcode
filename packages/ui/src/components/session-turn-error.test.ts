import { describe, expect, it } from "bun:test"
import { isComposeGateReminderMessage } from "./session-turn-error"

describe("isComposeGateReminderMessage", () => {
  it("matches compose gate reminder messages", () => {
    expect(
      isComposeGateReminderMessage(
        "Compose route requirements are still incomplete after repeated re-entry: run an explicit review pass; run explicit verification and record the evidence",
      ),
    ).toBe(true)
  })

  it("does not match normal model errors", () => {
    expect(isComposeGateReminderMessage("Provider is overloaded")).toBe(false)
  })
})
