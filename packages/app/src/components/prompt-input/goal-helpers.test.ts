import { describe, expect, test } from "bun:test"
import { formatGoalElapsed, formatGoalTokens, goalElapsedMs, goalStatusText } from "./goal-helpers"

describe("prompt-input goal helpers", () => {
  test("formats elapsed time in minutes and hours", () => {
    expect(formatGoalElapsed()).toBe("0m")
    expect(formatGoalElapsed(30_000)).toBe("1m")
    expect(formatGoalElapsed(5 * 60_000)).toBe("5m")
    expect(formatGoalElapsed(65 * 60_000)).toBe("1h 5m")
  })

  test("formats total tokens from stats", () => {
    expect(formatGoalTokens()).toBe("0")
    expect(
      formatGoalTokens({
        status: "active",
        stats: {
          tokens: {
            input: 10,
            output: 20,
            reasoning: 30,
          },
        },
      } as never),
    ).toBe("60")
  })

  test("derives active elapsed from activeSince locally", () => {
    expect(
      goalElapsedMs(
        {
          status: "active",
          stats: {
            elapsed: 2 * 60_000,
            activeSince: 1_000,
          },
        } as never,
        61_000,
      ),
    ).toBe(3 * 60_000)
    expect(
      goalElapsedMs(
        {
          status: "paused",
          stats: {
            elapsed: 2 * 60_000,
            activeSince: 1_000,
          },
        } as never,
        61_000,
      ),
    ).toBe(2 * 60_000)
  })

  test("maps status to localized copy", () => {
    expect(goalStatusText("active")).toBe("进行中")
    expect(goalStatusText("paused")).toBe("已暂停")
    expect(goalStatusText("blocked")).toBe("已阻塞")
    expect(goalStatusText("complete")).toBe("已完成")
    expect(goalStatusText("cleared")).toBe("已清除")
    expect(goalStatusText(undefined)).toBe("未设置")
  })
})
