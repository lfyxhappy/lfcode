import type { TavernCharacter, TavernGroup, TavernPersona, TavernPreset } from "./tavern-conversation"

export type TavernWorldbook = { id: string; name: string; content: string; source?: string }
export type TavernTrashKind = "characters" | "worldbooks" | "personas" | "presets" | "groups"

export type TavernTrashItem =
  | { id: string; kind: "characters"; deletedAt: number; item: TavernCharacter }
  | { id: string; kind: "worldbooks"; deletedAt: number; item: TavernWorldbook }
  | { id: string; kind: "personas"; deletedAt: number; item: TavernPersona }
  | { id: string; kind: "presets"; deletedAt: number; item: TavernPreset }
  | { id: string; kind: "groups"; deletedAt: number; item: TavernGroup }

export type TavernTrashData = {
  characters: TavernCharacter[]
  worldbooks: TavernWorldbook[]
  personas?: TavernPersona[]
  presets?: TavernPreset[]
  groups?: TavernGroup[]
  trash?: TavernTrashItem[]
}

export function moveTavernItemToTrash<T extends TavernTrashData>(data: T, kind: TavernTrashKind, id: string, deletedAt = Date.now()): T {
  const item = itemForKind(data, kind, id)
  if (!item) return data
  const trash = [...(data.trash ?? []).filter((entry) => entry.kind !== kind || entry.item.id !== id), { id: crypto.randomUUID(), kind, deletedAt, item } as TavernTrashItem]
  if (kind === "characters") return { ...data, characters: data.characters.filter((entry) => entry.id !== id), trash }
  if (kind === "worldbooks") return { ...data, worldbooks: data.worldbooks.filter((entry) => entry.id !== id), trash }
  if (kind === "personas") return { ...data, personas: (data.personas ?? []).filter((entry) => entry.id !== id), trash }
  if (kind === "presets") return { ...data, presets: (data.presets ?? []).filter((entry) => entry.id !== id), trash }
  return { ...data, groups: (data.groups ?? []).filter((entry) => entry.id !== id), trash }
}

export function restoreTavernTrashItem<T extends TavernTrashData>(data: T, trashID: string): T {
  const trashItem = data.trash?.find((entry) => entry.id === trashID)
  if (!trashItem) return data
  const trash = data.trash?.filter((entry) => entry.id !== trashID)
  if (trashItem.kind === "characters") return { ...data, characters: replaceByID(data.characters, trashItem.item), trash }
  if (trashItem.kind === "worldbooks") return { ...data, worldbooks: replaceByID(data.worldbooks, trashItem.item), trash }
  if (trashItem.kind === "personas") return { ...data, personas: replaceByID(data.personas ?? [], trashItem.item), trash }
  if (trashItem.kind === "presets") return { ...data, presets: replaceByID(data.presets ?? [], trashItem.item), trash }
  return { ...data, groups: replaceByID(data.groups ?? [], trashItem.item), trash }
}

function itemForKind(data: TavernTrashData, kind: TavernTrashKind, id: string) {
  if (kind === "characters") return data.characters.find((entry) => entry.id === id)
  if (kind === "worldbooks") return data.worldbooks.find((entry) => entry.id === id)
  if (kind === "personas") return data.personas?.find((entry) => entry.id === id)
  if (kind === "presets") return data.presets?.find((entry) => entry.id === id)
  return data.groups?.find((entry) => entry.id === id)
}

function replaceByID<T extends { id: string }>(items: T[], item: T) {
  return [...items.filter((entry) => entry.id !== item.id), item]
}
