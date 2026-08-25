import { describe, expect, test } from "bun:test"
import { appendTavernSwipe, removeTavernSwipe, resolveTavernSwipe } from "./tavern-swipe"

describe("Tavern swipe", () => {
  test("preserves imported candidates and activates a generated reply", () => {
    expect(appendTavernSwipe({
      sourceText: "第一条",
      metadata: { tavern: { swipes: ["第一条", "第二条"], swipeID: 1 } },
      text: "第三条",
    })).toEqual({ swipes: ["第一条", "第二条", "第三条"], swipeID: 2 })
  })

  test("creates a candidate set for a message without imported swipes", () => {
    expect(appendTavernSwipe({ sourceText: "原回复", metadata: {}, text: "新回复" }))
      .toEqual({ swipes: ["原回复", "新回复"], swipeID: 1 })
  })

  test("does not duplicate an identical generated reply", () => {
    expect(appendTavernSwipe({ sourceText: "原回复", metadata: {}, text: " 原回复 " }))
      .toEqual({ swipes: ["原回复"], swipeID: 0 })
    expect(resolveTavernSwipe({ tavern: { swipes: ["唯一候选"] } })).toBeUndefined()
  })

  test("deletes only the current candidate and keeps an adjacent reply active", () => {
    expect(removeTavernSwipe({ tavern: { swipes: ["第一条", "第二条", "第三条"], swipeID: 1 } }))
      .toEqual({ swipes: ["第一条", "第三条"], swipeID: 1, text: "第三条" })
    expect(removeTavernSwipe({ tavern: { swipes: ["第一条", "第二条"], swipeID: 1 } }))
      .toEqual({ swipes: ["第一条"], swipeID: 0, text: "第一条" })
  })
})
