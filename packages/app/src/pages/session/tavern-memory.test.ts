import { describe, expect, test } from "bun:test"
import { normalizeTavernMemorySettings, renderTavernMemoryContext, tavernMemoryProjectID } from "./tavern-memory"

describe("Tavern memory", () => {
  test("defaults recall to off and scopes group memories separately", () => {
    expect(normalizeTavernMemorySettings()).toEqual({ recall: false, limit: 3 })
    expect(tavernMemoryProjectID({ groupID: "party", characterID: "hero", worldbookIDs: [] })).toBe("group:party")
    expect(tavernMemoryProjectID({ characterID: "hero", worldbookIDs: [] })).toBe("character:hero")
  })

  test("renders recalled content as reference rather than dialogue", () => {
    expect(renderTavernMemoryContext([{ id: "a", layer: "project", content: "雾港在下雨", score: 0.9 }])).toContain("仅作为连续性参考")
  })
})
