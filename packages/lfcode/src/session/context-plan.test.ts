import { describe, expect, it } from "bun:test"
import { ContextPlan } from "./context-plan"
import { MessageID, PartID, SessionID } from "./schema"
import type { MessageV2 } from "./message-v2"

const sessionID = SessionID.make("ses_context_plan")
const message = (id: string, text: string): MessageV2.User => ({
  id: MessageID.make(id),
  sessionID,
  role: "user",
  time: { created: Date.now() },
  agent: "main",
  model: { providerID: "p", modelID: "m" },
} as MessageV2.User)

describe("ContextPlan", () => {
  it("updates only the affected message indexes for append and part delta", () => {
    const plan = ContextPlan.forSession(sessionID)
    plan.upsertMessage(message("msg_1", "hello"))
    plan.upsertMessage(message("msg_2", "world"))
    plan.upsertPart({ id: PartID.make("prt_1"), sessionID, messageID: MessageID.make("msg_1"), type: "text", text: "C:/work/a.ts" })
    const before = plan.snapshot()
    plan.upsertPart({ id: PartID.make("prt_2"), sessionID, messageID: MessageID.make("msg_2"), type: "text", text: "https://example.com" })
    const after = plan.snapshot()
    expect(after.messagesByID.size).toBe(2)
    expect(after.sourcesByMessageID.get("msg_1")).toEqual(["C:/work/a.ts"])
    expect(after.sourcesByMessageID.get("msg_2")).toEqual(["https://example.com"])
    expect(after.partRevision).toBe(before.partRevision + 1)
    expect(after.tokenEstimateByMessageID.get("msg_2")).toBeGreaterThan(0)
  })

  it("supports prepend and targeted deletion without dropping tail indexes", () => {
    const id = SessionID.make("ses_context_plan_prepend")
    const plan = ContextPlan.forSession(id)
    plan.upsertMessage({ ...message("msg_tail", "tail"), sessionID: id })
    plan.upsertMessage({ ...message("msg_head", "head"), sessionID: id })
    plan.upsertPart({ id: PartID.make("prt_tail"), sessionID: id, messageID: MessageID.make("msg_tail"), type: "text", text: "tail.ts" })
    plan.removeMessage(MessageID.make("msg_head"))
    expect(plan.snapshot().messagesByID.has("msg_tail")).toBe(true)
    expect(plan.snapshot().sourcesByMessageID.get("msg_tail")).toEqual(["tail.ts"])
    ContextPlan.drop(id)
  })
})
