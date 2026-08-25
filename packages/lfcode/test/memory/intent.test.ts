import { describe, expect, test } from "bun:test"
import { isExplicitMemoryRequest, isExplicitMemoryRequestText } from "../../src/memory/intent"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

describe("memory explicit intent", () => {
  test("accepts direct Chinese and English recall requests", () => {
    expect(isExplicitMemoryRequestText("查一下之前保存的记忆")).toBe(true)
    expect(isExplicitMemoryRequestText("Please search saved memory for the decision")).toBe(true)
    expect(isExplicitMemoryRequestText("回顾上次的约定")).toBe(true)
  })

  test("does not treat ordinary work as a memory request", () => {
    expect(isExplicitMemoryRequestText("修复侧边栏并做验证")).toBe(false)
    expect(isExplicitMemoryRequestText("继续上面的任务")).toBe(false)
  })

  test("uses only real text from the current user message", () => {
    const sessionID = SessionID.make("ses_memory_intent")
    const messageID = MessageID.make("msg_memory_intent")
    expect(
      isExplicitMemoryRequest([
        {
          info: { id: messageID, sessionID, role: "user" },
          parts: [
            {
              id: PartID.make("prt_memory_intent"),
              messageID,
              sessionID,
              type: "text",
              text: "修复这个问题",
            },
            {
              id: PartID.make("prt_memory_synthetic"),
              messageID,
              sessionID,
              type: "text",
              synthetic: true,
              text: "memory search",
            },
          ],
        } as never,
      ]),
    ).toBe(false)
  })
})
