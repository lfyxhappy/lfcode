import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateSync } from "node:zlib"
import type { createLfcodeClient } from "@lfcode-ai/sdk/v2"

type Character = {
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
  firstMessage?: string
  alternateGreetings?: string[]
  avatar?: string
  tags?: string[]
  worldbookIDs: string[]
}
type Worldbook = { id: string; name: string; content: string; source?: string }
type ImportedRecord = { id: string; name: string; path: string; source?: string; characterID?: string; sessionID?: string }
type Persona = { id: string; name: string; description: string; source?: string }
type Preset = { id: string; name: string; prompt?: string; config?: Record<string, unknown>; source?: string }
type Group = { id: string; name: string; memberIDs: string[]; source?: string }
type ChatMessage = { role: "user" | "assistant"; text: string; time?: number; swipes?: string[]; swipeID?: number }
type TavernData = {
  characters: Character[]
  worldbooks: Worldbook[]
  personas?: Persona[]
  presets?: Preset[]
  prompts?: ImportedRecord[]
  quickReplies?: ImportedRecord[]
  chats?: ImportedRecord[]
  groups?: Group[]
  sessions?: Record<string, { characterID: string; worldbookIDs: string[] }>
  settings?: {
    roadway?: {
      enabled: boolean
      autoTrigger: boolean
      autoOpen: boolean
      showUseAction: boolean
      autoSubmitUseAction: boolean
      extractionStrategy: "bullet" | "none"
      messageRole: "system" | "user" | "assistant"
      maxContextMessages: number
      maxOutputTokens: number
      prompt: string
      impersonatePrompt: string
      modelSource: "session"
    }
  }
  migration?: { version: number; importedAt: number; source: string }
}

const sourceRoot = "C:\\SillyTavern-private\\data\\default-user"

/**
 * The original user data is copied before any format conversion. This makes
 * the migration recoverable as the Tavern schema evolves and never changes
 * the original SillyTavern installation.
 */
export async function migrateSillyTavern(input: { data: string; client: ReturnType<typeof createLfcodeClient>; projectID: string }) {
  const data = input.data
  const vault = path.join(data, "migration-vault", "sillytavern")
  const marker = path.join(vault, "migration.json")
  const prior = await readJSON<{ version?: number }>(marker, {})
  if (prior.version && prior.version >= 11) return

  const archive = path.join(vault, "source")
  if (!(await exists(archive)) && !(await exists(sourceRoot))) return
  await mkdir(vault, { recursive: true })
  if (!(await exists(archive))) await cp(sourceRoot, archive, { recursive: true, force: false, errorOnExist: false })

  const target = path.join(data, "ui.json")
  const current = await readJSON<TavernData>(target, { characters: [], worldbooks: [] })
  const importedAt = Date.now()
  const roadway = await importRoadwaySettings(archive)
  if (prior.version && prior.version >= 5) {
    const characters = rehydrateTavernCharacters(current.characters, (await importRegistry(archive)).characters)
    const conversation = await importConversationRecords(archive, characters)
    const next = {
      ...current,
      characters,
      personas: mergeRehydrated(current.personas ?? [], conversation.personas),
      presets: mergeRehydrated(current.presets ?? [], conversation.presets),
      groups: mergeRehydrated(current.groups ?? [], conversation.groups),
      settings: roadway ? { ...current.settings, roadway } : current.settings,
      migration: { version: 11, importedAt, source: sourceRoot },
    }
    const migrated = await importChatSessions({ data, archive, current: next, client: input.client, projectID: input.projectID })
    await writeJSON(target, migrated)
    await writeJSON(marker, { ...prior, version: 11, source: sourceRoot, archive, completedAt: importedAt })
    return
  }

  const imported = await importRegistry(archive)
  const next = {
    ...current,
    characters: mergeByID(current.characters, imported.characters),
    worldbooks: mergeByID(current.worldbooks, imported.worldbooks),
    personas: mergeByID(current.personas ?? [], imported.personas),
    presets: mergeByID(current.presets ?? [], imported.presets),
    prompts: mergeByID(current.prompts ?? [], imported.prompts),
    quickReplies: mergeByID(current.quickReplies ?? [], imported.quickReplies),
    chats: mergeByID(current.chats ?? [], imported.chats),
    groups: mergeByID(current.groups ?? [], imported.groups),
    settings: roadway ? { ...current.settings, roadway } : current.settings,
    migration: { version: 11, importedAt, source: sourceRoot },
  }
  await writeJSON(target, next)
  const migrated = await importChatSessions({ data, archive, current: next, client: input.client, projectID: input.projectID })
  await writeJSON(marker, {
    version: 11,
    source: sourceRoot,
    archive,
    completedAt: importedAt,
    characters: imported.characters.length,
    worldbooks: imported.worldbooks.length,
    personas: imported.personas.length,
    presets: imported.presets.length,
    chats: migrated.chats.filter((item) => item.sessionID).length,
    groups: imported.groups.length,
  })
}

async function importRoadwaySettings(archive: string): Promise<NonNullable<NonNullable<TavernData["settings"]>["roadway"]> | undefined> {
  const settings = await readJSON<Record<string, unknown>>(path.join(archive, "settings.json"), {})
  const extensions = isRecord(settings.extension_settings) ? settings.extension_settings : undefined
  const source = extensions && isRecord(extensions.roadway) ? extensions.roadway : undefined
  if (!source) return
  const presets = isRecord(source.promptPresets) ? source.promptPresets : undefined
  const presetName = readString(source.promptPreset)
  const preset = presetName && presets && isRecord(presets[presetName]) ? presets[presetName] : undefined
  const maxContext = readNumber(source.maxContextValue)
  const maxOutput = readNumber(source.maxResponseToken)
  return {
    enabled: true,
    autoTrigger: readBoolean(source.autoTrigger, false),
    autoOpen: readBoolean(source.autoOpen, true),
    showUseAction: readBoolean(source.showUseActionIcon, true),
    autoSubmitUseAction: readBoolean(source.autoSubmitUseAction, false),
    extractionStrategy: preset?.extractionStrategy === "none" ? "none" : "bullet",
    messageRole: source.messageRole === "user" || source.messageRole === "assistant" ? source.messageRole : "system",
    // Roadway previously limited the prompt in tokens. The Lfcode helper limits
    // complete messages, so retain a comparable 256-token-per-message window.
    maxContextMessages: maxContext ? Math.min(200, Math.max(1, Math.ceil(maxContext / 256))) : 40,
    maxOutputTokens: maxOutput ? Math.min(16000, Math.max(16, Math.round(maxOutput))) : 500,
    prompt: readString(preset?.content) ?? defaultRoadwayPrompt,
    impersonatePrompt: readString(preset?.impersonate) ?? defaultRoadwayImpersonatePrompt,
    // SillyTavern connection profile IDs cannot be reused as Lfcode provider IDs.
    modelSource: "session",
  }
}

const defaultRoadwayPrompt = "你是一个 AI 剧情脑暴助手。根据当前角色设定、世界背景和局面，生成 6 条玩家接下来可以采取的清晰、可执行、简洁并且有创意的行动建议。只输出编号列表，不要输出解释或剧情正文。"
const defaultRoadwayImpersonatePrompt = "请以玩家的身份，把下面选中的行动改写成适合当前酒馆对话的第一人称回复。只输出玩家的说话和行动，不要替角色说话。\n\n选中的行动：\n{{roadwaySelected}}"

async function importChatSessions(input: {
  data: string
  archive: string
  current: TavernData
  client: ReturnType<typeof createLfcodeClient>
  projectID: string
}) {
  const sessions = input.current.sessions ?? {}
  const chats: ImportedRecord[] = []
  for (const chat of input.current.chats ?? []) {
    if (chat.sessionID) {
      const messages = await readChat(path.join(input.archive, chat.source ?? path.join("chats", chat.path)))
      if (messages.length) {
        await input.client.session.importHistory({
          sessionID: chat.sessionID,
          projectID: input.projectID,
          extension: { pluginID: "lfcode-tavern", type: "tavern" },
          title: `${findChatCharacter(chat, input.current.characters)?.name ?? chat.name} 的历史对话`,
          messages,
        })
      }
      chats.push(chat)
      continue
    }
    const messages = await readChat(path.join(input.archive, chat.source ?? path.join("chats", chat.path)))
    if (messages.length === 0) {
      chats.push(chat)
      continue
    }
    const character = findChatCharacter(chat, input.current.characters)
    const created = await input.client.session.importHistory({
      projectID: input.projectID,
      extension: { pluginID: "lfcode-tavern", type: "tavern" },
      title: `${character?.name ?? chat.name} 的历史对话`,
      messages,
    })
    if (!created.data) {
      chats.push(chat)
      continue
    }
    chats.push({ ...chat, characterID: character?.id, sessionID: created.data.id })
    if (character) sessions[created.data.id] = { characterID: character.id, worldbookIDs: character.worldbookIDs }
    await writeJSON(path.join(input.data, "ui.json"), { ...input.current, chats, sessions })
  }
  return { ...input.current, chats, sessions }
}

async function readChat(file: string): Promise<ChatMessage[]> {
  const source = await readFile(file, "utf8").catch(() => "")
  return source
    .split(/\r?\n/)
    .flatMap((line) => {
      const value = parseJSON(line)
      const swipes = readStrings(value?.swipes)
      const rawSwipeID = typeof value?.swipe_id === "number" && Number.isInteger(value.swipe_id) ? value.swipe_id : 0
      const swipeID = swipes?.length ? Math.min(Math.max(rawSwipeID, 0), swipes.length - 1) : undefined
      const text = swipes?.[swipeID ?? 0] ?? readString(value?.mes)
      if (!text) return []
      return [{
        role: value?.is_user === true ? "user" as const : "assistant" as const,
        text,
        time: parseTime(value?.send_date),
        swipes: value?.is_user === true ? undefined : swipes,
        swipeID: value?.is_user === true ? undefined : swipeID,
      }]
    })
}

function findChatCharacter(chat: ImportedRecord, characters: Character[]) {
  const directoryName = path.dirname(chat.path).toLocaleLowerCase()
  return characters.find((item) => item.name.toLocaleLowerCase() === directoryName)
}

function parseTime(value: unknown) {
  if (typeof value !== "string") return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

async function importRegistry(archive: string) {
  const worldbooks = await importWorldbooks(path.join(archive, "worlds"))
  const characters = await importCharacters(path.join(archive, "characters"), worldbooks)
  const conversation = await importConversationRecords(archive, characters)
  return {
    characters,
    worldbooks,
    ...conversation,
    prompts: await importRecords(path.join(archive, "instruct"), "prompt"),
    quickReplies: await importRecords(path.join(archive, "QuickReplies"), "quick-reply"),
    chats: await importRecords(path.join(archive, "chats"), "chat"),
  }
}

async function importConversationRecords(archive: string, characters: Character[]) {
  return {
    personas: await importPersonas(path.join(archive, "user")),
    presets: await importPresets(path.join(archive, "context")),
    groups: await importGroups(path.join(archive, "groups"), characters),
  }
}

async function importPersonas(directory: string): Promise<Persona[]> {
  const files = (await filesIn(directory, true)).filter((file) => path.extname(file).toLowerCase() === ".json")
  return Promise.all(files.map(async (file) => {
    const value = await readJSON<Record<string, unknown>>(path.join(directory, file), {})
    return {
      id: stableID("persona", file),
      name: readString(value.name) ?? path.basename(file, ".json"),
      description: readString(value.description) ?? readString(value.persona) ?? readString(value.content) ?? "",
      source: path.join("user", file),
    }
  }))
}

async function importPresets(directory: string): Promise<Preset[]> {
  const files = (await filesIn(directory, true)).filter((file) => path.extname(file).toLowerCase() === ".json")
  return Promise.all(files.map(async (file) => {
    const value = await readJSON<Record<string, unknown>>(path.join(directory, file), {})
    return {
      id: stableID("preset", file),
      name: readString(value.name) ?? path.basename(file, ".json"),
      prompt: readString(value.system_prompt) ?? readString(value.prompt) ?? readString(value.content),
      config: value,
      source: path.join("context", file),
    }
  }))
}

async function importGroups(directory: string, characters: Character[]): Promise<Group[]> {
  const files = (await filesIn(directory)).filter((file) => path.extname(file).toLowerCase() === ".json")
  return Promise.all(files.map(async (file) => {
    const value = await readJSON<Record<string, unknown>>(path.join(directory, file), {})
    const names = readStrings(value.members) ?? []
    const memberIDs = names
      .map((name) => path.basename(name, path.extname(name)).replace(/_data$/i, "").toLocaleLowerCase())
      .map((name) => characters.find((character) => character.name.toLocaleLowerCase() === name)?.id)
      .filter((id): id is string => !!id)
    return {
      id: stableID("group", file),
      name: readString(value.name) ?? path.basename(file, ".json"),
      memberIDs,
      source: path.join("groups", file),
    }
  }))
}

async function importWorldbooks(directory: string): Promise<Worldbook[]> {
  const files = await filesIn(directory)
  return Promise.all(
    files.filter((file) => path.extname(file).toLowerCase() === ".json").map(async (file) => ({
      id: stableID("worldbook", path.basename(file)),
      name: path.basename(file, ".json"),
      content: await readFile(path.join(directory, file), "utf8"),
      source: path.join("worlds", file),
    })),
  )
}

async function importCharacters(directory: string, worldbooks: Worldbook[]): Promise<Character[]> {
  const files = await filesIn(directory)
  const cards = await Promise.all(
    files.map(async (file) => ({ file, card: await readCharacterCard(path.join(directory, file)) })),
  )
  const selected = new Map<string, { file: string; card: Record<string, unknown> }>()
  for (const item of cards) {
    if (!item.card) continue
    const key = path.basename(item.file, path.extname(item.file)).replace(/_data$/i, "").toLocaleLowerCase()
    const existing = selected.get(key)
    // PNG is the canonical Tavern card when both it and the extracted JSON exist.
    if (!existing || path.extname(item.file).toLowerCase() === ".png") selected.set(key, { file: item.file, card: item.card })
  }

  const externalWorldbooks = new Map(worldbooks.map((item) => [item.name.toLocaleLowerCase(), item.id]))
  return [...selected.values()].sort((a, b) => a.file.localeCompare(b.file)).map(({ file, card }) => {
    const data = isRecord(card.data) ? card.data : card
    const name = readString(data.name) ?? path.basename(file, path.extname(file)).replace(/_data$/i, "")
    const embedded = isRecord(data.character_book) ? data.character_book : undefined
    const embeddedID = embedded ? stableID("character-worldbook", file) : undefined
    if (embedded && embeddedID && !worldbooks.some((item) => item.id === embeddedID)) {
      worldbooks.push({
        id: embeddedID,
        name: readString(embedded.name) ?? `${name} 的世界书`,
        content: JSON.stringify(embedded),
        source: path.join("characters", file),
      })
    }
    const externalName = readString(readNested(data, ["extensions", "world"])) ?? readString(data.world)
    const externalID = externalName ? externalWorldbooks.get(externalName.toLocaleLowerCase()) : undefined
    return {
      id: stableID("character", path.basename(file).replace(/_data\.json$/i, ".png")),
      name,
      prompt: characterPrompt(data),
      description: readString(data.description),
      personality: readString(data.personality),
      scenario: readString(data.scenario),
      exampleDialogue: readString(data.mes_example),
      systemPrompt: readString(data.system_prompt),
      postHistoryInstructions: readString(data.post_history_instructions),
      depthPrompt: readString(readNested(data, ["extensions", "depth_prompt", "prompt"])),
      firstMessage: readString(data.first_mes),
      alternateGreetings: readStrings(data.alternate_greetings),
      avatar: path.join("characters", file),
      tags: readStrings(data.tags),
      worldbookIDs: [embeddedID, externalID].filter((item): item is string => !!item),
    }
  })
}

function characterPrompt(data: Record<string, unknown>) {
  const depthPrompt = readNested(data, ["extensions", "depth_prompt", "prompt"])
  return [
    readString(data.description),
    readString(data.personality),
    readString(data.scenario),
    readString(data.mes_example),
    readString(data.system_prompt),
    readString(data.post_history_instructions),
    readString(depthPrompt),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function rehydrateTavernCharacters(current: Character[], imported: Character[]) {
  return current.map((item) => {
    const source = imported.find((candidate) => candidate.id === item.id)
    if (!source || item.prompt !== source.prompt || hasStructuredCharacterFields(item)) return item
    return {
      ...item,
      ...(source.description ? { description: source.description } : {}),
      ...(source.personality ? { personality: source.personality } : {}),
      ...(source.scenario ? { scenario: source.scenario } : {}),
      ...(source.exampleDialogue ? { exampleDialogue: source.exampleDialogue } : {}),
      ...(source.systemPrompt ? { systemPrompt: source.systemPrompt } : {}),
      ...(source.postHistoryInstructions ? { postHistoryInstructions: source.postHistoryInstructions } : {}),
      ...(source.depthPrompt ? { depthPrompt: source.depthPrompt } : {}),
    }
  })
}

function hasStructuredCharacterFields(character: Character) {
  return !!(
    character.description ||
    character.personality ||
    character.scenario ||
    character.exampleDialogue ||
    character.systemPrompt ||
    character.postHistoryInstructions ||
    character.depthPrompt
  )
}

async function importRecords(directory: string, type: string): Promise<ImportedRecord[]> {
  const files = await filesIn(directory, true)
  return files.map((file) => ({
    id: stableID(type, file),
    name: path.basename(file, path.extname(file)),
    path: file,
    source: path.join(path.basename(directory), file),
  }))
}

async function readCharacterCard(file: string): Promise<Record<string, unknown> | undefined> {
  const extension = path.extname(file).toLowerCase()
  if (extension === ".json") return parseJSON(await readFile(file, "utf8").catch(() => ""))
  if (extension !== ".png") return
  const buffer = await readFile(file).catch(() => undefined)
  if (!buffer || !buffer.subarray(1, 4).equals(Buffer.from("PNG"))) return
  for (let offset = 8; offset + 12 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) return
    const type = buffer.toString("latin1", offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset = end
    const chara = pngTextChunk(type, data)
    if (chara) return parseJSON(Buffer.from(chara, "base64").toString("utf8"))
  }
}

function pngTextChunk(type: string, data: Buffer) {
  const zero = data.indexOf(0)
  if (zero === -1 || data.subarray(0, zero).toString("latin1") !== "chara") return
  if (type === "tEXt") return data.subarray(zero + 1).toString("latin1")
  if (type === "zTXt" && data[zero + 1] === 0) return inflateSync(data.subarray(zero + 2)).toString("latin1")
  if (type !== "iTXt") return
  const compressionFlag = data[zero + 1]
  const compressionMethod = data[zero + 2]
  const languageEnd = data.indexOf(0, zero + 3)
  if (languageEnd === -1) return
  const translatedEnd = data.indexOf(0, languageEnd + 1)
  if (translatedEnd === -1) return
  const text = data.subarray(translatedEnd + 1)
  if (compressionFlag === 0) return text.toString("utf8")
  if (compressionFlag === 1 && compressionMethod === 0) return inflateSync(text).toString("utf8")
}

async function filesIn(directory: string, recursive = false): Promise<string[]> {
  if (!(await exists(directory))) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries.filter((file) => file.isFile()).map((file) => file.name)
  if (!recursive) return files
  const nested = await Promise.all(
    entries
      .filter((file) => file.isDirectory())
      .map(async (file) => (await filesIn(path.join(directory, file.name), true)).map((name) => path.join(file.name, name))),
  )
  return [...files, ...nested.flat()]
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  return (parseJSON(await readFile(file, "utf8").catch(() => "")) as T | undefined) ?? fallback
}

async function writeJSON(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8")
  await rename(temp, file)
}

function parseJSON(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return
  }
}

function mergeByID<T extends { id: string }>(current: T[], imported: T[]) {
  return [...current, ...imported.filter((item) => !current.some((existing) => existing.id === item.id))]
}

function mergeRehydrated<T extends { id: string; source?: string }>(current: T[], imported: T[]) {
  return [
    ...current.map((item) => item.source ? imported.find((candidate) => candidate.id === item.id) ?? item : item),
    ...imported.filter((item) => !current.some((existing) => existing.id === item.id)),
  ]
}

function stableID(type: string, value: string) {
  return `${type}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function readStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : undefined
}

function readNested(value: Record<string, unknown>, keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
}

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false)
}
