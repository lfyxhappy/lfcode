export type TavernLibraryCharacter = {
  id: string
  name: string
  prompt: string
  description?: string
  personality?: string
  scenario?: string
  tags?: string[]
}

export function tavernCharacterTags(characters: TavernLibraryCharacter[]) {
  return [...new Set(characters.flatMap((character) => character.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  )
}

export function filterTavernCharacters(input: { characters: TavernLibraryCharacter[]; query?: string; tag?: string }) {
  const query = input.query?.trim().toLocaleLowerCase() ?? ""
  const tag = input.tag?.trim()
  return input.characters
    .filter((character) => {
      if (tag && !character.tags?.includes(tag)) return false
      if (!query) return true
      return [character.name, character.description, character.personality, character.scenario, character.prompt, ...(character.tags ?? [])].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.id.localeCompare(b.id))
}
