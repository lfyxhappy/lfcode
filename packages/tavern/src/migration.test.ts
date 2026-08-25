import assert from "node:assert/strict"
import test from "node:test"
import { rehydrateTavernCharacters } from "./migration"

test("rehydrates V2 fields only when a migrated character still has its original prompt", () => {
  const imported = {
    id: "luna",
    name: "Luna",
    prompt: "Description\n\nWarm\n\nA garden",
    description: "Description",
    personality: "Warm",
    scenario: "A garden",
    worldbookIDs: [],
  }
  const unchanged = rehydrateTavernCharacters([{ ...imported, description: undefined, personality: undefined, scenario: undefined }], [imported])[0]!
  const edited = rehydrateTavernCharacters([{ ...imported, prompt: "Custom prompt", description: undefined, personality: undefined, scenario: undefined }], [imported])[0]!

  assert.equal(unchanged.description, "Description")
  assert.equal(unchanged.personality, "Warm")
  assert.equal(unchanged.scenario, "A garden")
  assert.equal(edited.description, undefined)
  assert.equal(edited.prompt, "Custom prompt")
})
