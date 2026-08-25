export type TavernAuthorNote = {
  content: string
}

export function normalizeTavernAuthorNote(value: unknown): TavernAuthorNote | undefined {
  if (!value || typeof value !== "object") return undefined
  const content = typeof (value as { content?: unknown }).content === "string" ? (value as { content: string }).content.trim().slice(0, 4_000) : ""
  if (!content) return undefined
  return { content }
}

export function renderTavernAuthorNote(note: TavernAuthorNote | undefined, expand = (value: string) => value) {
  if (!note?.content) return undefined
  return `作者注释：\n${expand(note.content)}`
}
