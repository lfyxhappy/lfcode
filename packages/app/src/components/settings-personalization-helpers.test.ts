import { describe, expect, test } from "bun:test"
import {
  createPersonalizationDraft,
  personalizationDirty,
  personalizationMessages,
  personalizationSaveDisabled,
  type PersonalizationState,
} from "./settings-personalization-helpers"

const state = (): PersonalizationState => ({
  customInstructions: "Be concise.",
  instructionFile: "C:/Users/demo/.config/lfcode/instructions/personalization.md",
  memory: {
    ccIndex: false,
    autoConsolidation: true,
  },
  maintenance: {
    enabled: true,
    schedulerEnabled: true,
    dreamEnabled: true,
    distillEnabled: true,
  },
})

describe("settings personalization helpers", () => {
  test("creates an editable draft without instruction metadata", () => {
    expect(createPersonalizationDraft(state())).toEqual({
      customInstructions: "Be concise.",
      memory: {
        ccIndex: false,
        autoConsolidation: true,
      },
      maintenance: {
        enabled: true,
        schedulerEnabled: true,
        dreamEnabled: true,
        distillEnabled: true,
      },
    })
  })

  test("detects textarea and toggle changes", () => {
    const saved = createPersonalizationDraft(state())
    expect(personalizationDirty(saved, saved)).toBe(false)
    expect(personalizationDirty(saved, { ...saved, customInstructions: "Be precise." })).toBe(true)
    expect(
      personalizationDirty(saved, {
        ...saved,
        memory: {
          ...saved.memory,
          ccIndex: true,
        },
      }),
    ).toBe(true)
    expect(
      personalizationDirty(saved, {
        ...saved,
        maintenance: {
          ...saved.maintenance,
          distillEnabled: false,
        },
      }),
    ).toBe(true)
    expect(
      personalizationDirty(saved, {
        ...saved,
        memory: {
          ...saved.memory,
          autoConsolidation: false,
        },
      }),
    ).toBe(true)
  })

  test("disables save when nothing changed, while loading, or when load failed", () => {
    const saved = createPersonalizationDraft(state())
    expect(
      personalizationSaveDisabled({
        saved,
        draft: saved,
        loading: false,
        saving: false,
      }),
    ).toBe(true)
    expect(
      personalizationSaveDisabled({
        saved,
        draft: { ...saved, customInstructions: "Be precise." },
        loading: true,
        saving: false,
      }),
    ).toBe(true)
    expect(
      personalizationSaveDisabled({
        saved,
        draft: { ...saved, customInstructions: "Be precise." },
        loading: false,
        saving: true,
      }),
    ).toBe(true)
    expect(
      personalizationSaveDisabled({
        saved,
        draft: { ...saved, customInstructions: "Be precise." },
        loading: false,
        saving: false,
        loadError: "load failed",
      }),
    ).toBe(true)
    expect(
      personalizationSaveDisabled({
        saved,
        draft: { ...saved, customInstructions: "Be precise." },
        loading: false,
        saving: false,
      }),
    ).toBe(false)
  })

  test("keeps load and save failures as visible settings messages", () => {
    expect(personalizationMessages()).toEqual([])
    expect(personalizationMessages("load failed")).toEqual(["load failed"])
    expect(personalizationMessages(undefined, "save failed")).toEqual(["save failed"])
    expect(personalizationMessages("load failed", "save failed")).toEqual(["load failed", "save failed"])
  })
})
