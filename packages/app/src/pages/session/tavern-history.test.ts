import { describe, expect, test } from "bun:test"
import { parseSillyTavernHistory, serializeSillyTavernHistory, setTavernHistoryCharacter } from "./tavern-history"

describe("setTavernHistoryCharacter", () => {
  test("binds an imported history to a character and preserves its greeting choice", () => {
    const result = setTavernHistoryCharacter({
      chats: [{ id: "history-1", name: "旧对话", path: "角色/旧对话.jsonl", sessionID: "session-1" }],
      characters: [{ id: "character-1", worldbookIDs: ["worldbook-1"] }],
      sessions: { "session-1": { characterID: "old-character", worldbookIDs: [], greetingIndex: 2 } },
      historyID: "history-1",
      characterID: "character-1",
    })

    expect(result).toEqual({
      chats: [{ id: "history-1", name: "旧对话", path: "角色/旧对话.jsonl", sessionID: "session-1", characterID: "character-1" }],
      sessions: { "session-1": { characterID: "character-1", worldbookIDs: ["worldbook-1"], greetingIndex: 2 } },
    })
  })

  test("removes the Tavern binding when a history is explicitly unbound", () => {
    const result = setTavernHistoryCharacter({
      chats: [{ id: "history-1", name: "旧对话", path: "角色/旧对话.jsonl", sessionID: "session-1", characterID: "character-1" }],
      characters: [{ id: "character-1", worldbookIDs: ["worldbook-1"] }],
      sessions: { "session-1": { characterID: "character-1", worldbookIDs: ["worldbook-1"] } },
      historyID: "history-1",
    })

    expect(result).toEqual({
      chats: [{ id: "history-1", name: "旧对话", path: "角色/旧对话.jsonl", sessionID: "session-1" }],
      sessions: {},
    })
  })
})

test("exports only visible Tavern text and preserves assistant swipes", () => {
  expect(serializeSillyTavernHistory([
    { info: { role: "user" }, parts: [{ type: "text", text: "玩家" }, { type: "text", text: "隐藏", synthetic: true }] },
    { info: { role: "assistant" }, parts: [{ type: "text", text: "候选二", metadata: { tavern: { swipes: ["候选一", "候选二"], swipeID: 1 } } }, { type: "tool", state: "ignored" }] },
  ])).toBe('{"chat_metadata":{"version":1}}\n{"is_user":true,"mes":"玩家"}\n{"is_user":false,"mes":"候选二","swipes":["候选一","候选二"],"swipe_id":1}\n')
})

describe("parseSillyTavernHistory", () => {
  test("parses text, skips metadata, and retains the selected character swipe", () => {
    expect(parseSillyTavernHistory([JSON.stringify({ chat_metadata: { version: 1 } }), JSON.stringify({ is_user: true, mes: "玩家消息" }), JSON.stringify({ is_user: false, mes: "旧回复", swipes: ["候选一", "候选二"], swipe_id: 1 }), JSON.stringify({ is_system: true, mes: "不应导入" })].join("\n"))).toEqual([
      { role: "user", text: "玩家消息" },
      { role: "assistant", text: "候选二", swipes: ["候选一", "候选二"], swipeID: 1 },
    ])
  })

  test("rejects files without usable SillyTavern messages", () => {
    expect(() => parseSillyTavernHistory('{"chat_metadata":{}}\nnot-json')).toThrow("未找到可导入")
  })
})
