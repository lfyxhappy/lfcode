export const PROMPT_FEATURES = ["browser-rendering"] as const

export type PromptFeature = (typeof PROMPT_FEATURES)[number]

export const PROMPT_FEATURE_OPTIONS = [
  {
    id: "browser-rendering",
    labelKey: "prompt.feature.browserRendering.label",
    descriptionKey: "prompt.feature.browserRendering.description",
  },
] as const satisfies ReadonlyArray<{
  id: PromptFeature
  labelKey: string
  descriptionKey: string
}>

export function normalizePromptFeatures(value: unknown) {
  if (!Array.isArray(value)) return [] satisfies PromptFeature[]
  return Array.from(new Set(value.filter((item): item is PromptFeature => PROMPT_FEATURES.includes(item as PromptFeature))))
}

export function nextPromptFeatures(current: PromptFeature[] | undefined, feature: PromptFeature, checked: boolean) {
  const normalized = normalizePromptFeatures(current)
  if (checked) return normalizePromptFeatures([...normalized, feature])
  return normalized.filter((item) => item !== feature)
}

const browserRenderingReminder = [
  "Interactive browser rendering is enabled for this conversation.",
  "When a visual, interactive, or app-like response would help, prefer returning a complete fenced ```lfcode-html block instead of only plain text.",
  "The block should contain self-contained HTML, CSS, and JavaScript that can run in the built-in browser panel without external build steps.",
  "Use normal text when a browser-rendered result would not add value.",
].join("\n")

export function promptFeaturesSystem(value: PromptFeature[] | undefined) {
  const features = normalizePromptFeatures(value)
  if (features.length === 0) return undefined

  const reminders = features.flatMap((feature) => {
    if (feature === "browser-rendering") return [browserRenderingReminder]
    return []
  })

  if (reminders.length === 0) return undefined

  return ["<system-reminder>", ...reminders, "</system-reminder>"].join("\n")
}
