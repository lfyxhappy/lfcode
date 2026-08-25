import { describe, expect, test } from "bun:test"
import { moveTavernItemToTrash, restoreTavernTrashItem, type TavernTrashData } from "./tavern-trash"

describe("Tavern trash", () => {
  test("moves a managed item out of the active registry without deleting its source", () => {
    const data: TavernTrashData = {
      characters: [{ id: "character-1", name: "A", prompt: "", worldbookIDs: [], source: "characters/a.png" }],
      worldbooks: [],
    }
    const result = moveTavernItemToTrash(data, "characters", "character-1", 123)

    expect(result.characters).toEqual([])
    expect(result.trash).toEqual([{
      id: expect.any(String),
      kind: "characters",
      deletedAt: 123,
      item: { id: "character-1", name: "A", prompt: "", worldbookIDs: [], source: "characters/a.png" },
    }])
  })

  test("restores an item once and keeps active IDs unique", () => {
    const data: TavernTrashData = {
      characters: [{ id: "character-1", name: "旧版本", prompt: "", worldbookIDs: [] }],
      worldbooks: [],
      trash: [{ id: "trash-1", kind: "characters", deletedAt: 123, item: { id: "character-1", name: "恢复版本", prompt: "", worldbookIDs: [] } }],
    }
    const result = restoreTavernTrashItem(data, "trash-1")

    expect(result.characters).toEqual([{ id: "character-1", name: "恢复版本", prompt: "", worldbookIDs: [] }])
    expect(result.trash).toEqual([])
  })
})
