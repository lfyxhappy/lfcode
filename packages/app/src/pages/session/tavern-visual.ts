export type TavernVisualAsset = {
  id: string
  label: string
  path: string
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
}

export type TavernVisualSettings = {
  background?: TavernVisualAsset
}

export function normalizeTavernAvatarPath(value: unknown) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("..")) return
  if (
    !value.startsWith("imports/characters/") &&
    !value.startsWith("characters/") &&
    !value.startsWith("visuals/")
  )
    return
  return value
}

export function normalizeTavernVisualAsset(value: unknown): TavernVisualAsset | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const item = value as Partial<TavernVisualAsset>
  if (typeof item.id !== "string" || !item.id) return
  if (typeof item.label !== "string" || !item.label.trim()) return
  if (
    typeof item.path !== "string" ||
    !item.path.startsWith("visuals/") ||
    item.path.includes("\\") ||
    item.path.includes("..")
  )
    return
  if (
    item.mime !== "image/png" &&
    item.mime !== "image/jpeg" &&
    item.mime !== "image/gif" &&
    item.mime !== "image/webp"
  )
    return
  return { id: item.id, label: item.label.trim(), path: item.path, mime: item.mime }
}

export function normalizeTavernVisualAssets(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const asset = normalizeTavernVisualAsset(item)
    return asset ? [asset] : []
  })
}

export function normalizeTavernVisualSettings(value: unknown): TavernVisualSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const background = normalizeTavernVisualAsset((value as { background?: unknown }).background)
  return background ? { background } : {}
}
