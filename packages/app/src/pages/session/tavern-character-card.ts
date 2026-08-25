import type { TavernVisualAsset } from "./tavern-visual"

type Inflate = (input: Uint8Array) => Promise<string | undefined>

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

export type TavernEditableCharacter = {
  id: string
  name: string
  prompt: string
  description?: string
  personality?: string
  scenario?: string
  exampleDialogue?: string
  systemPrompt?: string
  postHistoryInstructions?: string
  depthPrompt?: string
  worldbookIDs: string[]
  firstMessage?: string
  alternateGreetings?: string[]
  tags?: string[]
  avatar?: string
  expressions?: TavernVisualAsset[]
  source?: string
}

export function createTavernCharacter(input: {
  id: string
  name: string
  prompt: string
  description?: string
  personality?: string
  scenario?: string
  exampleDialogue?: string
  systemPrompt?: string
  postHistoryInstructions?: string
  depthPrompt?: string
  firstMessage: string
  alternateGreetings: string
  tags: string
}) {
  return updateTavernCharacter({
    character: { id: input.id, name: "", prompt: "", worldbookIDs: [] },
    ...input,
  })
}

export function updateTavernCharacter(input: {
  character: TavernEditableCharacter
  name: string
  prompt: string
  description?: string
  personality?: string
  scenario?: string
  exampleDialogue?: string
  systemPrompt?: string
  postHistoryInstructions?: string
  depthPrompt?: string
  firstMessage: string
  alternateGreetings: string
  tags: string
}) {
  const name = input.name.trim()
  if (!name) throw new Error("请填写角色名称")
  const description = (input.description ?? input.prompt).trim()
  return {
    id: input.character.id,
    name,
    // Keep prompt for existing conversations and older private data readers.
    prompt: description,
    ...(description ? { description } : {}),
    ...(text(input.personality) ? { personality: text(input.personality) } : {}),
    ...(text(input.scenario) ? { scenario: text(input.scenario) } : {}),
    ...(text(input.exampleDialogue) ? { exampleDialogue: text(input.exampleDialogue) } : {}),
    ...(text(input.systemPrompt) ? { systemPrompt: text(input.systemPrompt) } : {}),
    ...(text(input.postHistoryInstructions) ? { postHistoryInstructions: text(input.postHistoryInstructions) } : {}),
    ...(text(input.depthPrompt) ? { depthPrompt: text(input.depthPrompt) } : {}),
    worldbookIDs: input.character.worldbookIDs,
    ...(input.firstMessage.trim() ? { firstMessage: input.firstMessage.trim() } : {}),
    ...(lines(input.alternateGreetings).length ? { alternateGreetings: lines(input.alternateGreetings) } : {}),
    ...(tokens(input.tags).length ? { tags: tokens(input.tags) } : {}),
    ...(input.character.avatar ? { avatar: input.character.avatar } : {}),
    ...(input.character.expressions?.length ? { expressions: input.character.expressions } : {}),
  }
}

export async function readTavernCharacterCard(file: File) {
  const extension = file.name.toLowerCase().split(".").at(-1)
  if (extension === "json") {
    try {
      return record(JSON.parse(await file.text()))
    } catch {
      return
    }
  }
  if (extension !== "png") return
  return parseTavernCharacterCardPng(new Uint8Array(await file.arrayBuffer()))
}

export async function parseTavernCharacterCardPng(bytes: Uint8Array, inflate: Inflate = inflatePngText) {
  if (!isPng(bytes)) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = pngSignature.length; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return
    const value = await charaText(
      new TextDecoder("latin1").decode(bytes.slice(offset + 4, offset + 8)),
      bytes.slice(offset + 8, offset + 8 + length),
      inflate,
    )
    offset = end
    if (!value) continue
    const card = decodeCard(value)
    if (card) return card
  }
}

async function charaText(type: string, data: Uint8Array, inflate: Inflate) {
  const zero = data.indexOf(0)
  if (zero === -1 || new TextDecoder("latin1").decode(data.slice(0, zero)) !== "chara") return
  if (type === "tEXt") return new TextDecoder("latin1").decode(data.slice(zero + 1))
  if (type === "zTXt" && data[zero + 1] === 0) return inflate(data.slice(zero + 2))
  if (type !== "iTXt") return
  const languageEnd = data.indexOf(0, zero + 3)
  if (languageEnd === -1) return
  const translatedEnd = data.indexOf(0, languageEnd + 1)
  if (translatedEnd === -1) return
  const text = data.slice(translatedEnd + 1)
  if (data[zero + 1] === 0) return new TextDecoder().decode(text)
  if (data[zero + 1] === 1 && data[zero + 2] === 0) return inflate(text)
}

async function inflatePngText(input: Uint8Array) {
  if (typeof DecompressionStream === "undefined") return
  try {
    const stream = new Blob([Uint8Array.from(input)]).stream().pipeThrough(new DecompressionStream("deflate"))
    return new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer())
  } catch {
    return
  }
}

function decodeCard(value: string) {
  try {
    const binary = atob(value.replace(/\s/g, ""))
    return record(JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (item) => item.charCodeAt(0)))))
  } catch {
    return
  }
}

function isPng(value: Uint8Array) {
  return pngSignature.every((item, index) => value[index] === item)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function tokens(value: string) {
  return value
    .split(/[\r\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function text(value: string | undefined) {
  return value?.trim()
}
