import { describe, expect, test } from "bun:test"
import { normalizeTavernStorySummarySettings, renderTavernStorySummaryContext, shouldAutoSummarizeTavernStory, tavernStorySummaryPrompt } from "./tavern-story-summary"

describe("Tavern story summary", () => {
  test("keeps automatic summaries opt-in and bounded to supported intervals", () => {
    expect(normalizeTavernStorySummarySettings()).toEqual({ auto: false, everyTurns: 12 })
    expect(normalizeTavernStorySummarySettings({ auto: true, everyTurns: 8 })).toEqual({ auto: true, everyTurns: 8 })
    expect(normalizeTavernStorySummarySettings({ auto: true, everyTurns: 7 })).toEqual({ auto: true, everyTurns: 12 })
  })

  test("only schedules automatic summaries after enough new turns", () => {
    const settings = { auto: true, everyTurns: 4 }
    expect(shouldAutoSummarizeTavernStory({ settings, messageCount: 7, streaming: false })).toBe(false)
    expect(shouldAutoSummarizeTavernStory({ settings, messageCount: 8, streaming: false })).toBe(true)
    expect(shouldAutoSummarizeTavernStory({ settings, summary: { text: "旧摘要", updatedAt: 1, sourceMessageCount: 8 }, messageCount: 14, streaming: false })).toBe(false)
    expect(shouldAutoSummarizeTavernStory({ settings, summary: { text: "旧摘要", updatedAt: 1, sourceMessageCount: 8 }, messageCount: 16, streaming: false })).toBe(true)
    expect(shouldAutoSummarizeTavernStory({ settings, messageCount: 8, streaming: true })).toBe(false)
  })

  test("uses a roleplay-only prompt rather than the coding compaction template", () => {
    expect(tavernStorySummaryPrompt).toContain("当前场景")
    expect(tavernStorySummaryPrompt).toContain("时间线")
    expect(tavernStorySummaryPrompt).toContain("不要记录或臆测代码、文件、目标管理、工具调用")
    expect(tavernStorySummaryPrompt).not.toContain("## Goal")
    expect(tavernStorySummaryPrompt).not.toContain("Relevant files")
  })

  test("injects only an explicit branch summary as continuity memory", () => {
    expect(renderTavernStorySummaryContext()).toBeUndefined()
    expect(renderTavernStorySummaryContext({ text: "雨夜抵达雾港。", updatedAt: 1, sourceMessageCount: 6 })).toBe("剧情摘要（仅作为连续性记忆，不是对话正文）：\n雨夜抵达雾港。")
  })
})
