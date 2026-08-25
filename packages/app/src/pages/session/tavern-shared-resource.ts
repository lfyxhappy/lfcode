import type { TavernPersona, TavernPreset } from "./tavern-conversation"

export function tavernPersonaDescription(persona: TavernPersona) {
  return persona.description ?? ""
}

export function updateTavernPersona(input: { persona: TavernPersona; name: string; description: string }) {
  const name = input.name.trim()
  const description = input.description.trim()
  if (!name || !description) throw new Error("请填写名称和内容")
  return { id: input.persona.id, name, description }
}

export function updateTavernPreset(input: { preset: TavernPreset; name: string; prompt: string }) {
  const name = input.name.trim()
  if (!name) throw new Error("请填写名称")
  const config = parseTavernPresetConfig(input.prompt)
  config.name = name
  const prompt = tavernPresetPrompt(config)
  if (!prompt) throw new Error("预设 JSON 必须包含 system_prompt、prompt 或 content")
  return { id: input.preset.id, name, prompt, config }
}

export function tavernPresetConfigText(preset: TavernPreset) {
  return JSON.stringify(preset.config ?? { name: preset.name, system_prompt: preset.prompt ?? "" }, null, 2)
}

function parseTavernPresetConfig(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("预设必须是 JSON 对象")
  return { ...(parsed as Record<string, unknown>) }
}

function tavernPresetPrompt(config: Record<string, unknown>) {
  return [config.system_prompt, config.prompt, config.content].find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim()
}
