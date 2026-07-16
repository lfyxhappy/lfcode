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

export type PersonalizationDraft = {
  customInstructions: string
  memory: PersonalizationMemoryDraft
  maintenance: PersonalizationMaintenanceDraft
}

export type PersonalizationState = PersonalizationDraft & {
  instructionFile: string
}

export function createPersonalizationDraft(input: PersonalizationState): PersonalizationDraft {
  return {
    customInstructions: input.customInstructions,
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
  }
}

export function personalizationDirty(saved: PersonalizationDraft | undefined, draft: PersonalizationDraft) {
  if (!saved) return false
  return (
    saved.customInstructions !== draft.customInstructions ||
    saved.memory.ccIndex !== draft.memory.ccIndex ||
    saved.memory.autoConsolidation !== draft.memory.autoConsolidation ||
    saved.maintenance.enabled !== draft.maintenance.enabled ||
    saved.maintenance.schedulerEnabled !== draft.maintenance.schedulerEnabled ||
    saved.maintenance.dreamEnabled !== draft.maintenance.dreamEnabled ||
    saved.maintenance.distillEnabled !== draft.maintenance.distillEnabled
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
