import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

describe("session header translations", () => {
  test("localizes the pinned summary toggle", () => {
    expect(en["session.header.summary.toggle"]).toBe("Toggle pinned summary")
    expect(zh["session.header.summary.toggle"]).toBe("切换固定摘要")
    expect(zht["session.header.summary.toggle"]).toBe("切換固定摘要")
  })
})
