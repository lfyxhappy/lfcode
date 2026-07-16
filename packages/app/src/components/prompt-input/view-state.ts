import { PROMPT_FEATURE_OPTIONS, type PromptFeature } from "@/utils/prompt-features"

export function promptMotion(value: number) {
  return {
    opacity: value,
    transform: `scale(${0.95 + value * 0.05})`,
    filter: `blur(${(1 - value) * 2}px)`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  }
}

export function promptControlStyle(value: number) {
  return { height: "28px", ...promptMotion(value) }
}

export function promptCommentCount(
  mode: "normal" | "shell",
  items: ReadonlyArray<{
    comment?: string
  }>,
) {
  if (mode === "shell") return 0
  return items.filter((item) => !!item.comment?.trim()).length
}

export function promptVisibleContextItems<T extends { comment?: string }>(mode: "normal" | "shell", items: T[]) {
  if (mode !== "shell") return items
  return items.filter((item) => !item.comment?.trim())
}

export function sessionHasUserPrompt(messages: ReadonlyArray<{ role?: string }> | undefined) {
  if (!messages) return false
  return messages.some((message) => message.role === "user")
}

export function promptFeatureItems(
  enabled: PromptFeature[] | undefined,
  t: (key: string) => string,
) {
  const features = enabled ?? []
  return PROMPT_FEATURE_OPTIONS.map((feature) => ({
    id: feature.id,
    checked: features.includes(feature.id),
    label: t(feature.labelKey),
    description: t(feature.descriptionKey),
  }))
}
