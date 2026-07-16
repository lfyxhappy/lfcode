import { describe, expect, test } from "bun:test"
import { mergeSessionGoal } from "./session-goal"

describe("mergeSessionGoal", () => {
  test("stores full goal state and latest verdict keyed by message id", () => {
    const next = mergeSessionGoal(undefined, {
      goal: {
        status: "active",
        objective: "Ship release",
        condition: "Ship release",
        react: 1,
        blockedCount: 0,
        stats: {
          elapsed: 120000,
          started: 1,
          tokens: {
            input: 10,
            output: 5,
            reasoning: 2,
            cache: { read: 3, write: 1 },
          },
        },
        time: { created: 1, updated: 2 },
      },
      lastVerdict: {
        ok: false,
        reason: "still missing installer",
        attempt: 1,
        messageID: "msg_1",
      },
    })

    expect(next?.state?.objective).toBe("Ship release")
    expect(next?.state?.stats?.tokens?.input).toBe(10)
    expect(next?.lastMessageID).toBe("msg_1")
    expect(next?.verdicts.msg_1?.reason).toBe("still missing installer")
  })

  test("keeps verdict history when the active goal is cleared", () => {
    const next = mergeSessionGoal(
      {
        state: {
          status: "active",
          objective: "Ship release",
          condition: "Ship release",
        },
        verdicts: {
          msg_1: {
            ok: false,
            reason: "still missing installer",
            attempt: 1,
          },
        },
        lastMessageID: "msg_1",
      },
      { goal: undefined },
    )

    expect(next?.state).toBeUndefined()
    expect(next?.verdicts.msg_1?.reason).toBe("still missing installer")
    expect(next?.lastMessageID).toBe("msg_1")
  })
})
