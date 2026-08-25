import { describe, expect, test } from "bun:test"
import { findTavernQuickReply, insertTavernQuickReply } from "./tavern-quick-replies"

describe("Tavern Quick Replies", () => {
  const reply = { id: "greet", label: "问候", message: "你好 {{char}}", append: false }

  test("resolves a reply only within its declared set", () => {
    expect(findTavernQuickReply([{ id: "default", name: "Default", replies: [reply] }], "default:greet")).toEqual(reply)
    expect(findTavernQuickReply([{ id: "default", name: "Default", replies: [reply] }], "other:greet")).toBeUndefined()
  })

  test("replaces or appends without sending automatically", () => {
    expect(insertTavernQuickReply("已有草稿", reply)).toBe("你好 {{char}}")
    expect(insertTavernQuickReply("已有草稿", { ...reply, append: true })).toBe("已有草稿\n你好 {{char}}")
  })
})
