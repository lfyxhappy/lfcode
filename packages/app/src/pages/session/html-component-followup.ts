import type { FollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"
import type { HtmlComponentEventDetail } from "@lfcode-ai/ui/markdown"
import type { QuestionGuidance } from "@/utils/question-guidance"

type FollowupSeed = {
  sessionID: string
  sessionDirectory: string
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  questionGuidance?: QuestionGuidance
}

function stringify(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatHtmlComponentFollowup(detail: HtmlComponentEventDetail) {
  const lines = [`[组件交互: ${detail.title}]`, `event: ${detail.event}`]
  const payload = stringify(detail.payload)
  const state = stringify(detail.state)
  if (payload !== undefined) lines.push(`payload: ${payload}`)
  if (state !== undefined) lines.push(`state: ${state}`)
  return lines.join("\n")
}

export function buildHtmlComponentFollowupDraft(
  detail: HtmlComponentEventDetail,
  seed: FollowupSeed,
): FollowupDraft {
  const text = formatHtmlComponentFollowup(detail)
  const prompt: Prompt = [{ type: "text", content: text, start: 0, end: text.length }]
  return {
    ...seed,
    prompt,
    context: [],
  }
}
