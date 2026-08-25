import { describe, expect, test } from "bun:test"
import { expandTavernMacros } from "./tavern-macros"
import { isTavernVisibleUserMessage, nextTavernGroupSpeaker, parseTavernAutoSpeaker, renderTavernCharacterPrompt, renderTavernConversationContext, resolveTavernConversation, tavernAutoSpeakerPrompt, tavernGroupTurnOrder, tavernVisibleTranscript } from "./tavern-conversation"

const data = {
  characters: [
    { id: "a", name: "艾达", prompt: "{{char}} 会倾听 {{user}}。", worldbookIDs: ["world-a"] },
    { id: "b", name: "贝拉", prompt: "{{char}} 会保护队伍。", worldbookIDs: ["world-b"] },
  ],
  personas: [{ id: "p", name: "林", description: "{{user}} 是一位旅行者。" }],
  presets: [{ id: "preset", name: "叙事", prompt: "保持第三人称叙事。" }],
  groups: [{ id: "g", name: "远征队", memberIDs: ["a", "b"] }],
  sessions: {},
}

describe("Tavern conversation context", () => {
  test("uses the selected group speaker, persona, and preset", () => {
    const context = renderTavernConversationContext(resolveTavernConversation(data, {
      groupID: "g",
      speakerID: "b",
      personaID: "p",
      presetID: "preset",
      worldbookIDs: [],
    }))
    expect(context.join("\n")).toContain("群组：远征队")
    expect(context.join("\n")).toContain("当前发言角色：贝拉")
    expect(context.join("\n")).toContain("林 是一位旅行者")
    expect(context.join("\n")).toContain("保持第三人称叙事")
  })

  test("keeps existing single-character bindings compatible", () => {
    const resolved = resolveTavernConversation(data, { characterID: "a", worldbookIDs: ["world-a"] })
    expect(resolved.group).toBeUndefined()
    expect(resolved.speaker?.name).toBe("艾达")
  })

  test("uses the supplied macro expansion for character context", () => {
    const context = renderTavernConversationContext(resolveTavernConversation({ ...data, characters: [{ ...data.characters[0], prompt: "来自 {{getvar::city}}" }] }, { characterID: "a", worldbookIDs: [], variables: { city: "雾港" } }), (value) => expandTavernMacros(value, { variables: { city: "雾港" } }))

    expect(context.join("\n")).toContain("雾港")
  })

  test("uses structured V2 fields instead of flattening them into a legacy prompt", () => {
    const text = renderTavernCharacterPrompt({
      id: "a",
      name: "艾达",
      prompt: "legacy prompt",
      description: "角色描述",
      personality: "冷静",
      scenario: "雾港码头",
      exampleDialogue: "{{char}}：欢迎。",
      systemPrompt: "保持角色身份。",
      postHistoryInstructions: "维持连续性。",
      depthPrompt: "优先近期行动。",
      worldbookIDs: [],
    })

    expect(text).toBe("角色描述\n\n冷静\n\n雾港码头\n\n{{char}}：欢迎。\n\n保持角色身份。\n\n维持连续性。\n\n优先近期行动。")
  })

  test("keeps manual speakers and schedules round-robin or random group turns", () => {
    const members = data.characters
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "manual" })).toBe("a")
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "round-robin" })).toBe("b")
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "b", mode: "round-robin" })).toBe("a")
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "random", random: () => 0 })).toBe("b")
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "random", random: () => 1 })).toBe("b")
  })

  test("uses configured random speaker weights without changing other modes", () => {
    const members = [...data.characters, { id: "c", name: "希亚", prompt: "", worldbookIDs: [] }]
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "random", memberWeights: { b: 1, c: 9 }, random: () => 0.2 })).toBe("c")
    expect(nextTavernGroupSpeaker({ members, currentSpeakerID: "a", mode: "random", memberWeights: { b: 0, c: 0 }, random: () => 0 })).toBe("b")
  })

  test("starts a sequential group turn from the selected speaker without duplicating members", () => {
    expect(tavernGroupTurnOrder(data.characters, "b")).toEqual(["b", "a"])
    expect(tavernGroupTurnOrder(data.characters)).toEqual(["a", "b"])
  })

  test("keeps synthetic continuation boundaries out of visible player turns and later transcripts", () => {
    const messages = [
      { id: "player", role: "user" as const },
      { id: "continuation", role: "user" as const },
      { id: "reply", role: "assistant" as const },
    ]
    const parts = {
      player: [{ type: "text", text: "继续探索" }],
      continuation: [{ type: "text", text: "内部续写", synthetic: true }],
      reply: [{ type: "text", text: "角色继续前行。" }],
    }

    expect(isTavernVisibleUserMessage(messages[0], parts.player)).toBe(true)
    expect(isTavernVisibleUserMessage(messages[1], parts.continuation)).toBe(false)
    expect(tavernVisibleTranscript(messages, (messageID) => parts[messageID as keyof typeof parts])).toEqual([
      { role: "user", text: "继续探索" },
      { role: "assistant", text: "角色继续前行。" },
    ])
  })

  test("limits automatic speaker selection to current group member IDs", () => {
    const prompt = tavernAutoSpeakerPrompt({ members: data.characters, text: "贝拉应该先回应吗？" })

    expect(prompt).toContain("a | 艾达")
    expect(prompt).toContain("b | 贝拉")
    expect(parseTavernAutoSpeaker("b", data.characters)).toBe("b")
    expect(parseTavernAutoSpeaker("选择 b，因为她最适合。", data.characters)).toBe("b")
    expect(parseTavernAutoSpeaker("unknown-character", data.characters)).toBeUndefined()
    expect(nextTavernGroupSpeaker({ members: data.characters, currentSpeakerID: "b", mode: "auto" })).toBe("b")
  })
})
