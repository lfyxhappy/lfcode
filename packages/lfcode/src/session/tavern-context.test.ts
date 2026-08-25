import { describe, expect, test } from "bun:test"
import { insertTavernContext } from "./tavern-context"

describe("Tavern history context", () => {
  test("inserts depth entries at their positions without changing persisted history", () => {
    const messages = [
      { role: "user" as const, content: "one" },
      { role: "assistant" as const, content: "two" },
      { role: "user" as const, content: "three" },
    ]

    expect(
      insertTavernContext(messages, {
        depth: [
          { content: "Near", depth: 1 },
          { content: "Older", depth: 3 },
          { content: "Latest", depth: 0 },
        ],
      }),
    ).toEqual([
      { role: "system", content: "世界书（历史深度 3）：\nOlder" },
      messages[0],
      messages[1],
      { role: "system", content: "世界书（历史深度 1）：\nNear" },
      messages[2],
      { role: "system", content: "世界书（历史深度 0）：\nLatest" },
    ])
  })

  test("leaves ordinary requests unchanged and clamps depths older than retained history", () => {
    const messages = [{ role: "user" as const, content: "latest" }]

    expect(insertTavernContext(messages)).toBe(messages)
    expect(insertTavernContext(messages, { depth: [{ content: "Archived", depth: 99 }] })[0]).toEqual({
      role: "system",
      content: "世界书（历史深度 99）：\nArchived",
    })
  })

  test("keeps same-depth entries in their input order", () => {
    const messages = [{ role: "user" as const, content: "latest" }]

    expect(
      insertTavernContext(messages, {
        depth: [
          { content: "First", depth: 1 },
          { content: "Second", depth: 1 },
        ],
      }).slice(0, 2),
    ).toEqual([
      { role: "system", content: "世界书（历史深度 1）：\nFirst" },
      { role: "system", content: "世界书（历史深度 1）：\nSecond" },
    ])
  })
})
