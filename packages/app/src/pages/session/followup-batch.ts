import type { FollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"

export function canBatchFollowupDrafts(previous: FollowupDraft, next: FollowupDraft) {
  return (
    previous.sessionID === next.sessionID &&
    previous.sessionDirectory === next.sessionDirectory &&
    previous.agent === next.agent &&
    previous.model.providerID === next.model.providerID &&
    previous.model.modelID === next.model.modelID &&
    previous.variant === next.variant &&
    previous.system === next.system &&
    JSON.stringify(previous.questionGuidance) === JSON.stringify(next.questionGuidance) &&
    JSON.stringify(previous.promptFeatures) === JSON.stringify(next.promptFeatures)
  )
}

export function batchFollowupDrafts(drafts: FollowupDraft[]): FollowupDraft {
  const first = drafts[0]
  if (!first) throw new Error("Cannot batch empty follow-up drafts")
  if (drafts.length === 1) return first

  let position = 0
  const prompt = drafts.flatMap((draft, index) => {
    const separator: Prompt =
      index === 0
        ? []
        : [
            {
              type: "text",
              content: "\n\n",
              start: position,
              end: position + 2,
            },
          ]
    position += separator.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)
    return [
      ...separator,
      ...draft.prompt.map((part) => {
        if (!("content" in part)) return part
        const next = { ...part, start: position, end: position + part.content.length }
        position = next.end
        return next
      }),
    ]
  })

  return {
    ...first,
    prompt,
    context: drafts.flatMap((draft) => draft.context).filter((item, index, items) => items.findIndex((next) => next.key === item.key) === index),
  }
}
