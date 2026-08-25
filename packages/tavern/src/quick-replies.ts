import { readFile, stat } from "node:fs/promises"
import path from "node:path"

export type TavernQuickReply = {
  id: string
  label: string
  title?: string
  message: string
  append: boolean
}

export type TavernQuickReplySet = {
  id: string
  name: string
  replies: TavernQuickReply[]
}

type QuickReplyIndex = { id: string; name: string; source: string }

const maxFiles = 50
const maxFileBytes = 1_000_000
const maxReplies = 100
const sourcePrefix = "QuickReplies/"

export async function loadTavernQuickReplies(data: string) {
  const index = await readQuickReplyIndex(data)
  const vault = path.resolve(data, "migration-vault", "sillytavern", "source")
  return (await Promise.all(index.slice(0, maxFiles).map(async (item) => {
    const source = item.source.replaceAll("\\", "/")
    if (!source.startsWith(sourcePrefix) || !source.endsWith(".json")) return
    const file = path.resolve(vault, source)
    if (!isWithinDirectory(vault, file)) return
    const size = await stat(file).then((value) => value.size).catch(() => 0)
    if (!size || size > maxFileBytes) return
    const value = parseJSONRecord(await readFile(file, "utf8").catch(() => ""))
    if (!value || !Array.isArray(value.qrList)) return
    const replies = value.qrList.flatMap((item, index) => parseQuickReply(item, index, value.injectInput === true)).slice(0, maxReplies)
    if (!replies.length) return
    return { id: item.id, name: item.name, replies } satisfies TavernQuickReplySet
  }))).filter((item): item is TavernQuickReplySet => !!item)
}

async function readQuickReplyIndex(data: string): Promise<QuickReplyIndex[]> {
  const root = parseJSONRecord(await readFile(path.join(data, "ui.json"), "utf8").catch(() => ""))
  if (!root || !Array.isArray(root.quickReplies)) return []
  return root.quickReplies.flatMap((item) => {
    const value = record(item)
    if (!value || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.source !== "string") return []
    return [{ id: value.id, name: value.name.slice(0, 200), source: value.source }]
  })
}

function parseQuickReply(input: unknown, index: number, append: boolean): TavernQuickReply[] {
  const value = record(input)
  if (!value || value.isHidden === true || typeof value.message !== "string" || !value.message.trim()) return []
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 200) : `快捷回复 ${index + 1}`
  return [{
    id: typeof value.id === "number" || typeof value.id === "string" ? String(value.id) : String(index),
    label,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 500) : undefined,
    message: value.message.slice(0, 10_000),
    append,
  }]
}

function isWithinDirectory(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function parseJSONRecord(text: string) {
  try {
    return record(JSON.parse(text))
  } catch {
    return
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}
