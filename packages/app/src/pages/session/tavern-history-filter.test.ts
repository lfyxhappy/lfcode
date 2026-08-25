import { describe, expect, test } from "bun:test"
import { filterTavernHistory } from "./tavern-history"

describe("filterTavernHistory", () => {
  const input = {
    chats: [
      { id: "one", name: "雨夜", path: "rain.jsonl", sessionID: "session-one" },
      { id: "two", name: "海边", path: "beach.jsonl", characterID: "char-two" },
      { id: "three", name: "未绑定", path: "unknown.jsonl" },
    ],
    characters: [
      { id: "char-one", name: "绫子", worldbookIDs: [] },
      { id: "char-two", name: "小雪", worldbookIDs: [] },
    ],
    sessions: { "session-one": { characterID: "char-one", worldbookIDs: [] } },
  }

  test("按历史、文件路径或绑定角色搜索", () => {
    expect(filterTavernHistory({ ...input, query: "绫子" }).map((item) => item.id)).toEqual(["one"])
    expect(filterTavernHistory({ ...input, query: "beach" }).map((item) => item.id)).toEqual(["two"])
  })

  test("按角色或未绑定状态筛选", () => {
    expect(filterTavernHistory({ ...input, characterID: "char-two" }).map((item) => item.id)).toEqual(["two"])
    expect(filterTavernHistory({ ...input, characterID: "unbound" }).map((item) => item.id)).toEqual(["three"])
  })
})
