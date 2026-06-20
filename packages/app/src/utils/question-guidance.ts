export const QUESTION_GUIDANCE_OPTIONS = ["none", "normal", "high"] as const

export type QuestionGuidance = (typeof QUESTION_GUIDANCE_OPTIONS)[number]

export const DEFAULT_QUESTION_GUIDANCE: QuestionGuidance = "normal"

export function normalizeQuestionGuidance(value: unknown): QuestionGuidance {
  if (value === "none" || value === "high") return value
  return DEFAULT_QUESTION_GUIDANCE
}

export function questionGuidanceSystem(value: QuestionGuidance | undefined) {
  const guidance = normalizeQuestionGuidance(value)
  if (guidance === "normal") return undefined
  if (guidance === "none") {
    return [
      "<system-reminder>",
      "Question guidance for this user turn: minimize proactive use of the question tool.",
      "Do not ask about preferences, implementation paths, or minor ambiguities. Choose a reasonable path and continue.",
      "Only ask the user when missing input would make progress impossible, create irreversible/high-risk impact, or require an explicit user decision.",
      "This does not change permission prompts or other explicit confirmation tools.",
      "</system-reminder>",
    ].join("\n")
  }
  return [
    "<system-reminder>",
    "Question guidance for this user turn: prefer asking the user at meaningful decision points.",
    "Use the question tool when there is high-impact ambiguity, unclear user preference, multiple credible implementation paths, or uncertain acceptance criteria.",
    "Keep questions concise and choice-oriented so the user can decide quickly.",
    "This does not change permission prompts or other explicit confirmation tools.",
    "</system-reminder>",
  ].join("\n")
}
