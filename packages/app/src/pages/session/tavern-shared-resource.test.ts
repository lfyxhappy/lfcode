import { expect, test } from "bun:test"
import { tavernPersonaDescription, tavernPresetConfigText, updateTavernPersona, updateTavernPreset } from "./tavern-shared-resource"

test("uses an empty editable value for legacy Personas without a description", () => {
  expect(tavernPersonaDescription({ id: "persona", name: "Legacy" })).toBe("")
})

test("updates shared Tavern resources without retaining their imported source", () => {
  expect(updateTavernPersona({ persona: { id: "persona", name: "Old", description: "Old", source: "user/old.json" }, name: " New ", description: " Description " })).toEqual({ id: "persona", name: "New", description: "Description" })
  expect(updateTavernPreset({ preset: { id: "preset", name: "Old", prompt: "Old", source: "context/old.json" }, name: " New ", prompt: '{"system_prompt":"Prompt","temperature":0.7}' })).toEqual({ id: "preset", name: "New", prompt: "Prompt", config: { name: "New", system_prompt: "Prompt", temperature: 0.7 } })
})

test("edits the full SillyTavern preset JSON while keeping legacy presets editable", () => {
  expect(tavernPresetConfigText({ id: "preset", name: "Legacy", prompt: "Prompt" })).toBe('{\n  "name": "Legacy",\n  "system_prompt": "Prompt"\n}')
  expect(() => updateTavernPreset({ preset: { id: "preset", name: "Preset" }, name: "Preset", prompt: '{"temperature":0.7}' })).toThrow("预设 JSON 必须包含")
})
