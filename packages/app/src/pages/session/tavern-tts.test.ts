import { describe, expect, test } from "bun:test"
import { normalizeTavernSpeechSettings, tavernSpeechText } from "./tavern-tts"

describe("tavern tts", () => {
  test("normalizes persisted speech settings into safe browser bounds", () => {
    expect(normalizeTavernSpeechSettings({ rate: 99, pitch: -1, volume: 2, voiceURI: "  " })).toEqual({
      provider: "system",
      enabled: true,
      autoPlay: false,
      rate: 2,
      pitch: 0,
      volume: 1,
      voiceURI: undefined,
    })
  })

  test("keeps the explicit external provider while retaining safe defaults", () => {
    expect(normalizeTavernSpeechSettings({ provider: "openai-compatible" })).toMatchObject({
      provider: "openai-compatible",
      enabled: true,
      autoPlay: false,
    })
  })

  test("keeps the explicit MiMo provider across persisted settings", () => {
    expect(normalizeTavernSpeechSettings({ provider: "mimo" })).toMatchObject({ provider: "mimo", enabled: true, autoPlay: false })
  })

  test("removes markup before passing text to a speech engine", () => {
    expect(tavernSpeechText("**你好** <em>世界</em> [角色卡](https://example.com) `代码`"))
      .toBe("你好 世界 角色卡 代码")
  })
})
