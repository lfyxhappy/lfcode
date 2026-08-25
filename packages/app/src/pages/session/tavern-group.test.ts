import { expect, test } from "bun:test"
import { rebindTavernGroupSpeakers, updateTavernGroup } from "./tavern-group"

test("updates a Tavern group without retaining its imported source", () => {
  expect(
    updateTavernGroup({
      group: { id: "group", name: "Old", memberIDs: ["a"], memberWeights: { a: 1 }, avatar: "groups/old.png", source: "groups/old.json" },
      name: " New ",
      memberIDs: ["b", "b", "a"],
      memberWeights: { a: 101, b: -1 },
    }),
  ).toEqual({ id: "group", name: "New", memberIDs: ["b", "a"], memberWeights: { b: 0, a: 100 }, avatar: "groups/old.png" })
})

test("requires a named group with at least one member", () => {
  expect(() => updateTavernGroup({ group: { id: "group", name: "Old", memberIDs: [] }, name: " ", memberIDs: [], memberWeights: {} })).toThrow("请填写群组名称并至少选择一名角色")
})

test("rebinds only affected sessions when a group member is removed", () => {
  const group = { id: "group", name: "New", memberIDs: ["b"], memberWeights: { b: 1 } }
  expect(
    rebindTavernGroupSpeakers({
      group,
      sessions: {
        affected: { groupID: "group", speakerID: "a", worldbookIDs: [] },
        retained: { groupID: "group", speakerID: "b", worldbookIDs: [] },
        unrelated: { groupID: "other", speakerID: "a", worldbookIDs: [] },
      },
    }),
  ).toEqual({
    affected: { groupID: "group", speakerID: "b", worldbookIDs: [] },
    retained: { groupID: "group", speakerID: "b", worldbookIDs: [] },
    unrelated: { groupID: "other", speakerID: "a", worldbookIDs: [] },
  })
})
