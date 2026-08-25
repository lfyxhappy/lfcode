import { describe, expect, test } from "bun:test"
import { buildTavernRequestContext } from "./tavern-request"

describe("Tavern request context", () => {
  test("keeps depth worldbook entries out of the aggregated system context", () => {
    const context = buildTavernRequestContext({
      worldbooks: [
        {
          id: "book",
          name: "World",
          content: JSON.stringify({
            entries: [
              { content: "Character lore", constant: true, position: 1 },
              { content: "Depth lore", constant: true, position: 6, depth: 3 },
            ],
          }),
        },
      ],
      worldbookIDs: ["book"],
      transcript: [],
      memory: [],
    })

    expect(context.system).toContain("Character lore")
    expect(context.system).not.toContain("Depth lore")
    expect(context.tavernContext).toEqual({ depth: [{ content: "Depth lore", depth: 3 }] })
  })

  test("keeps author-note positions on their respective sides of the note", () => {
    const context = buildTavernRequestContext({
      worldbooks: [
        {
          id: "book",
          name: "World",
          content: JSON.stringify({
            entries: [
              { content: "Before note", constant: true, position: 4 },
              { content: "After note", constant: true, position: 5 },
            ],
          }),
        },
      ],
      worldbookIDs: ["book"],
      transcript: [],
      memory: [],
      authorNote: { content: "Narrator note" },
    })

    expect(context.system.indexOf("Before note")).toBeLessThan(context.system.indexOf("作者注释：\nNarrator note"))
    expect(context.system.indexOf("作者注释：\nNarrator note")).toBeLessThan(context.system.indexOf("After note"))
  })
})
