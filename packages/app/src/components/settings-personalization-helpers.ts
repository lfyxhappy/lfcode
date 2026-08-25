export type PersonalizationMemoryDraft = {
  ccIndex: boolean
  autoConsolidation: boolean
}

export type PersonalizationMaintenanceDraft = {
  enabled: boolean
  schedulerEnabled: boolean
  dreamEnabled: boolean
  distillEnabled: boolean
}

export type PersonalizationContextReviewDraft = {
  enabled: boolean
}

export type PersonalizationTone = "friendly" | "professional"

export type PersonalizationDraft = {
  customInstructions: string
  tone: PersonalizationTone
  memory: PersonalizationMemoryDraft
  maintenance: PersonalizationMaintenanceDraft
  contextReview: PersonalizationContextReviewDraft
}

export type PersonalizationState = Omit<PersonalizationDraft, "tone"> & {
  instructionFile: string
}

const toneBlock = /<!-- lfcode:personalization-tone:(friendly|professional) -->[\s\S]*?<!-- lfcode:personalization-tone:end -->\s*/m

const tonePrompt: Record<PersonalizationTone, string> = {
  friendly: "Use a warm, approachable, and collaborative tone while staying clear and actionable.",
  professional: "Use a professional, precise, and concise tone with direct, actionable guidance.",
}

export function extractPersonalizationTone(input: string): PersonalizationTone {
  if (input.match(toneBlock)?.[1] === "professional") return "professional"
  return "friendly"
}

export function stripPersonalizationTone(input: string) {
  return input.replace(toneBlock, "").trim()
}

export function serializePersonalizationInstructions(input: string, tone: PersonalizationTone) {
  const body = stripPersonalizationTone(input)
  const block = [
    `<!-- lfcode:personalization-tone:${tone} -->`,
    tonePrompt[tone],
    "<!-- lfcode:personalization-tone:end -->",
  ].join("\n")
  return body ? `${block}\n\n${body}` : block
}

export function createPersonalizationDraft(input: PersonalizationState): PersonalizationDraft {
  return {
    customInstructions: stripPersonalizationTone(input.customInstructions),
    tone: extractPersonalizationTone(input.customInstructions),
    memory: {
      ccIndex: input.memory.ccIndex,
      autoConsolidation: input.memory.autoConsolidation,
    },
    maintenance: {
      enabled: input.maintenance.enabled,
      schedulerEnabled: input.maintenance.schedulerEnabled,
      dreamEnabled: input.maintenance.dreamEnabled,
      distillEnabled: input.maintenance.distillEnabled,
    },
    contextReview: {
      enabled: input.contextReview.enabled,
    },
  }
}

export function personalizationDirty(saved: PersonalizationDraft | undefined, draft: PersonalizationDraft) {
  if (!saved) return false
  return (
    saved.customInstructions !== draft.customInstructions ||
    saved.tone !== draft.tone ||
    saved.memory.ccIndex !== draft.memory.ccIndex ||
    saved.memory.autoConsolidation !== draft.memory.autoConsolidation ||
    saved.maintenance.enabled !== draft.maintenance.enabled ||
    saved.maintenance.schedulerEnabled !== draft.maintenance.schedulerEnabled ||
    saved.maintenance.dreamEnabled !== draft.maintenance.dreamEnabled ||
    saved.maintenance.distillEnabled !== draft.maintenance.distillEnabled ||
    saved.contextReview.enabled !== draft.contextReview.enabled
  )
}

export function personalizationSaveDisabled(input: {
  saved: PersonalizationDraft | undefined
  draft: PersonalizationDraft
  loading: boolean
  saving: boolean
  loadError?: string
}) {
  if (input.loading || input.saving) return true
  if (input.loadError) return true
  return !personalizationDirty(input.saved, input.draft)
}

export function personalizationMessages(loadError?: string, saveError?: string) {
  return [loadError, saveError].filter((value): value is string => !!value)
}
