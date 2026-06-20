import { describe, expect, test } from "bun:test"
import { normalizeQuestionGuidance, questionGuidanceSystem } from "./question-guidance"

describe("question guidance", () => {
  test("normalizes unknown values to normal", () => {
    expect(normalizeQuestionGuidance(undefined)).toBe("normal")
    expect(normalizeQuestionGuidance("normal")).toBe("normal")
    expect(normalizeQuestionGuidance("none")).toBe("none")
    expect(normalizeQuestionGuidance("high")).toBe("high")
    expect(normalizeQuestionGuidance("off")).toBe("normal")
  })

  test("does not inject system guidance for normal mode", () => {
    expect(questionGuidanceSystem(undefined)).toBeUndefined()
    expect(questionGuidanceSystem("normal")).toBeUndefined()
  })

  test("builds low and high guidance system reminders", () => {
    expect(questionGuidanceSystem("none")).toContain("minimize proactive use of the question tool")
    expect(questionGuidanceSystem("high")).toContain("prefer asking the user at meaningful decision points")
  })
})
