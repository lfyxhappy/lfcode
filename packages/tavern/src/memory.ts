import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"

export type TavernMemoryLayer = "project" | "conversation"

export type TavernMemoryEntry = {
  id: string
  projectID: string
  conversationID?: string
  layer: TavernMemoryLayer
  content: string
  source: "manual" | "summary"
  createdAt: number
  updatedAt: number
  embedding?: number[]
}

export type TavernMemoryStore = { entries: TavernMemoryEntry[] }

export type TavernEmbeddingConfig = {
  baseUrl: string
  model: string
}

export const tavernEmbeddingDefaults: TavernEmbeddingConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "text-embedding-3-small",
}

const maxEntries = 2_000
const maxContentLength = 8_000

export function normalizeTavernEmbeddingConfig(value?: Partial<TavernEmbeddingConfig>): TavernEmbeddingConfig {
  return {
    baseUrl: typeof value?.baseUrl === "string" && value.baseUrl.trim() ? value.baseUrl.trim().replace(/\/$/, "") : tavernEmbeddingDefaults.baseUrl,
    model: typeof value?.model === "string" && value.model.trim() ? value.model.trim() : tavernEmbeddingDefaults.model,
  }
}

export function normalizeTavernMemoryEntry(value: Partial<TavernMemoryEntry>): TavernMemoryEntry | undefined {
  const content = typeof value.content === "string" ? value.content.trim().slice(0, maxContentLength) : ""
  if (!content || !value.id || !value.projectID || (value.layer !== "project" && value.layer !== "conversation")) return undefined
  const embedding = Array.isArray(value.embedding) && value.embedding.length > 0 && value.embedding.length <= 4_096 && value.embedding.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value.embedding
    : undefined
  return {
    id: value.id,
    projectID: value.projectID,
    conversationID: value.layer === "conversation" && typeof value.conversationID === "string" ? value.conversationID : undefined,
    layer: value.layer,
    content,
    source: value.source === "summary" ? "summary" : "manual",
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    embedding,
  }
}

export async function readTavernMemoryStore(data: string): Promise<TavernMemoryStore> {
  const text = await readFile(path.join(data, "memory-index.json"), "utf8").catch(() => "")
  if (!text) return { entries: [] }
  try {
    const parsed = JSON.parse(text) as { entries?: Partial<TavernMemoryEntry>[] }
    return { entries: (parsed.entries ?? []).map(normalizeTavernMemoryEntry).filter((item): item is TavernMemoryEntry => !!item).slice(-maxEntries) }
  } catch {
    return { entries: [] }
  }
}

export async function writeTavernMemoryStore(data: string, store: TavernMemoryStore) {
  const target = path.join(data, "memory-index.json")
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await mkdir(data, { recursive: true })
  await writeFile(temporary, JSON.stringify({ entries: store.entries.slice(-maxEntries) }, null, 2) + "\n", "utf8")
  await rename(temporary, target)
}

export async function readTavernEmbeddingConfig(data: string): Promise<TavernEmbeddingConfig> {
  const text = await readFile(path.join(data, "embeddings.json"), "utf8").catch(() => "")
  if (!text) return tavernEmbeddingDefaults
  try {
    return normalizeTavernEmbeddingConfig(JSON.parse(text) as Partial<TavernEmbeddingConfig>)
  } catch {
    return tavernEmbeddingDefaults
  }
}

export async function writeTavernEmbeddingConfig(data: string, config: TavernEmbeddingConfig) {
  const target = path.join(data, "embeddings.json")
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await mkdir(data, { recursive: true })
  await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", "utf8")
  await rename(temporary, target)
}

export async function createTavernEmbedding(input: { config: TavernEmbeddingConfig; apiKey: string; text: string; fetch?: typeof fetch }) {
  const response = await (input.fetch ?? fetch)(`${input.config.baseUrl}/embeddings`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: input.config.model, input: input.text }),
  })
  if (!response.ok) throw new Error(`Embedding request failed (${response.status})`)
  const value = await response.json() as { data?: Array<{ embedding?: unknown }> }
  const embedding = value.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > 4_096 || !embedding.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new Error("Embedding response is invalid")
  }
  return embedding
}

export function rankTavernMemories(input: {
  entries: TavernMemoryEntry[]
  projectID: string
  conversationID: string
  embedding: number[]
  limit: number
}) {
  return input.entries
    .filter((entry) => entry.projectID === input.projectID && (entry.layer === "project" || entry.conversationID === input.conversationID) && entry.embedding?.length === input.embedding.length)
    .map((entry) => ({ entry, score: cosineSimilarity(entry.embedding!, input.embedding) }))
    .filter((item) => item.score >= 0.25)
    .sort((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, Math.max(1, Math.min(input.limit, 8)))
}

function cosineSimilarity(left: number[], right: number[]) {
  const state = left.reduce((result, value, index) => {
    const candidate = right[index]
    if (candidate === undefined) return result
    return { dot: result.dot + value * candidate, left: result.left + value * value, right: result.right + candidate * candidate }
  }, { dot: 0, left: 0, right: 0 })
  if (!state.left || !state.right) return 0
  return state.dot / Math.sqrt(state.left * state.right)
}
