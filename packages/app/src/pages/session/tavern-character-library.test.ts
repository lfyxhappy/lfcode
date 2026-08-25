import { describe, expect, test } from "bun:test"
import { filterTavernCharacters, tavernCharacterTags } from "./tavern-character-library"

const characters = [
  { id: "a", name: "阿澈", prompt: "侦探", personality: "冷静", tags: ["现代", "侦探"] },
  { id: "b", name: "贝拉", prompt: "法师", scenario: "雾港", tags: ["奇幻", "魔法"] },
  { id: "c", name: "晨星", prompt: "", description: "飞船工程师", tags: ["科幻", "现代"] },
]

describe("Tavern character library", () => {
  test("collects distinct sorted tags", () => {
    expect(tavernCharacterTags(characters)).toEqual(["科幻", "魔法", "奇幻", "现代", "侦探"])
  })

  test("searches names, structured fields, legacy prompts, and tags", () => {
    expect(filterTavernCharacters({ characters, query: "雾港" }).map((item) => item.id)).toEqual(["b"])
    expect(filterTavernCharacters({ characters, query: "工程" }).map((item) => item.id)).toEqual(["c"])
    expect(filterTavernCharacters({ characters, query: "侦探" }).map((item) => item.id)).toEqual(["a"])
  })

  test("filters by tag and sorts matching results deterministically", () => {
    expect(filterTavernCharacters({ characters, tag: "现代" }).map((item) => item.id)).toEqual(["a", "c"])
  })
})
