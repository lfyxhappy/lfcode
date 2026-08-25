import path from "node:path"
import { readFile, rename, writeFile } from "node:fs/promises"

const maximumExportBytes = 16 * 1024 * 1024

export type TavernExportKind = "character" | "worldbook"

type TavernRecord = Record<string, unknown>

export async function exportTavernResource(input: { data: string; kind: TavernExportKind; id: string }) {
  const data = record(JSON.parse(await readFile(path.join(input.data, "ui.json"), "utf8")))
  const collection = input.kind === "character" ? array(data?.characters) : array(data?.worldbooks)
  const item = collection.find((entry) => string(record(entry)?.id) === input.id)
  if (!item) throw new Error("要导出的酒馆资源不存在")

  const original = await readOriginalTavernExport({ data: input.data, kind: input.kind, source: string(record(item)?.source) })
  if (original) return original

  const json = input.kind === "character"
    ? characterCard(record(item) ?? {}, array(data?.worldbooks).map((entry) => record(entry)).filter((entry): entry is TavernRecord => !!entry))
    : worldbook(record(item) ?? {})
  const filename = `${safeFilename(string(record(item)?.name) ?? "tavern")}.json`
  return {
    base64: Buffer.from(JSON.stringify(json, null, 2) + "\n", "utf8").toString("base64"),
    filename,
    mime: "application/json",
    original: false,
  }
}

export async function writeTavernExport(input: { data: string; kind: TavernExportKind; id: string; output: string }) {
  if (!path.isAbsolute(input.output)) throw new Error("酒馆导出路径必须是绝对路径")
  const resource = await exportTavernResource(input)
  const target = path.resolve(input.output)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, Buffer.from(resource.base64, "base64"), { flag: "wx" })
  await rename(temporary, target)
  return { filename: path.basename(target), bytes: Buffer.from(resource.base64, "base64").length, original: resource.original }
}

async function readOriginalTavernExport(input: { data: string; kind: TavernExportKind; source?: string }) {
  if (!input.source) return
  const source = path.resolve(input.data, input.source)
  const relative = path.relative(input.data, source).replaceAll("\\", "/")
  const allowed = input.kind === "character" ? "imports/characters/" : "imports/worldbooks/"
  if (!relative.startsWith(allowed) || path.isAbsolute(relative)) return
  const extension = path.extname(source).toLowerCase()
  if (input.kind === "character" && extension !== ".json" && extension !== ".png") return
  if (input.kind === "worldbook" && extension !== ".json") return
  const bytes = await readFile(source).catch(() => undefined)
  if (!bytes || bytes.length === 0 || bytes.length > maximumExportBytes) return
  return {
    base64: bytes.toString("base64"),
    filename: safeFilename(path.basename(source)),
    mime: extension === ".png" ? "image/png" : "application/json",
    original: true,
  }
}

function characterCard(character: TavernRecord, worldbooks: TavernRecord[]) {
  const linked = new Set(strings(character.worldbookIDs))
  const embedded = worldbooks.find((item) => linked.has(string(item.id) ?? ""))
  const characterBook = embedded ? parseJSON(string(embedded.content) ?? "") : undefined
  const data = {
    name: string(character.name) ?? "角色",
    description: string(character.description) ?? string(character.prompt) ?? "",
    ...(string(character.personality) ? { personality: string(character.personality) } : {}),
    ...(string(character.scenario) ? { scenario: string(character.scenario) } : {}),
    ...(string(character.exampleDialogue) ? { mes_example: string(character.exampleDialogue) } : {}),
    ...(string(character.systemPrompt) ? { system_prompt: string(character.systemPrompt) } : {}),
    ...(string(character.postHistoryInstructions) ? { post_history_instructions: string(character.postHistoryInstructions) } : {}),
    ...(string(character.depthPrompt) ? { extensions: { depth_prompt: { prompt: string(character.depthPrompt) } } } : {}),
    first_mes: string(character.firstMessage) ?? "",
    alternate_greetings: strings(character.alternateGreetings),
    tags: strings(character.tags),
    ...(characterBook ? { character_book: characterBook } : {}),
  }
  return { spec: "chara_card_v2", spec_version: "2.0", data }
}

function worldbook(item: TavernRecord) {
  const content = string(item.content) ?? ""
  return parseJSON(content) ?? { name: string(item.name) ?? "世界书", entries: {} }
}

function parseJSON(value: string) {
  try {
    return record(JSON.parse(value))
  } catch {
    return
  }
}

function safeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "tavern"
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function record(value: unknown): TavernRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as TavernRecord : undefined
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : []
}
