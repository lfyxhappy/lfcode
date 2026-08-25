export function resolveTavernSwipe(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return
  const tavern = (metadata as { tavern?: unknown }).tavern
  if (typeof tavern !== "object" || tavern === null || Array.isArray(tavern)) return
  const raw = tavern as { swipes?: unknown; swipeID?: unknown }
  if (!Array.isArray(raw.swipes)) return
  const swipes = raw.swipes.filter((item): item is string => typeof item === "string" && !!item.trim())
  if (swipes.length < 2) return
  const swipeID = typeof raw.swipeID === "number" && Number.isInteger(raw.swipeID)
    ? Math.min(Math.max(raw.swipeID, 0), swipes.length - 1)
    : 0
  return { swipes, swipeID }
}

export function appendTavernSwipe(input: { sourceText: string; metadata: unknown; text: string }) {
  const swipes = [...(resolveTavernSwipe(input.metadata)?.swipes ?? [input.sourceText]), input.text.trim()]
    .filter((item, index, all) => !!item.trim() && all.indexOf(item) === index)
  return { swipes, swipeID: Math.max(0, swipes.indexOf(input.text.trim())) }
}

export function removeTavernSwipe(metadata: unknown) {
  const current = resolveTavernSwipe(metadata)
  if (!current) return
  const swipes = current.swipes.filter((_, index) => index !== current.swipeID)
  if (swipes.length === 0) return
  const swipeID = Math.min(current.swipeID, swipes.length - 1)
  return { swipes, swipeID, text: swipes[swipeID] }
}
