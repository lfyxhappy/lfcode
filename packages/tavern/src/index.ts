import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { action, defineServerPlugin } from "@lfcode-ai/plugin"
import { migrateSillyTavern } from "./migration"
import { loadTavernQuickReplies } from "./quick-replies"
import { createTavernEmbedding, normalizeTavernEmbeddingConfig, normalizeTavernMemoryEntry, rankTavernMemories, readTavernEmbeddingConfig, readTavernMemoryStore, writeTavernEmbeddingConfig, writeTavernMemoryStore } from "./memory"
import { exportTavernResource, writeTavernExport } from "./export"
import { archiveTavernHistory, writeTavernHistoryExport } from "./history-archive"
import { putTavernVisualAsset, readTavernVisualAssets, removeTavernVisualAsset } from "./visual-assets"

const extension = {
  pluginID: "lfcode-tavern",
  type: "tavern",
}

const ttsDefaults = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
}

type TavernTtsConfig = {
  baseUrl: string
  model: string
  voice: string
}

export default defineServerPlugin({
  id: "lfcode-tavern",
  async server(input) {
    if (!input.data) throw new Error("Lfcode Tavern requires its private plugin data directory")
    const client = input.clientV2
    if (!client) throw new Error("Lfcode Tavern requires the V2 plugin RPC client")
    const secureStorage = input.secureStorage

    // A plugin server is constructed while the current project Instance is still
    // booting. Awaiting an instance-scoped RPC here would wait for that same
    // Instance to finish booting, causing a self-deadlock. The request is
    // idempotent and can safely settle once the instance accepts requests.
    void client.project
      .createManaged(
        {
          extension,
          worktree: path.join(input.data, "projects", "tavern"),
          name: "酒馆",
        },
        { throwOnError: true },
      )
      .then((result) => {
        if (!result.data) return
        return migrateSillyTavern({ data: input.data!, client, projectID: result.data.id })
      })
      .catch(() => undefined)

    return {
      action: {
        visualAssetPut: action({
          input: action.schema.object({
            filename: action.schema.string().min(1).max(240),
            base64: action.schema.string().min(4).max(20_000_000),
          }),
          async execute(value) {
            return putTavernVisualAsset({ data: input.data!, ...value })
          },
        }),
        visualAssetRead: action({
          input: action.schema.object({ paths: action.schema.array(action.schema.string().min(1).max(300)).max(4) }),
          async execute(value) {
            return readTavernVisualAssets({ data: input.data!, ...value })
          },
        }),
        visualAssetRemove: action({
          input: action.schema.object({ path: action.schema.string().min(1).max(300) }),
          async execute(value) {
            return removeTavernVisualAsset({ data: input.data!, ...value })
          },
        }),
        historyExport: action({
          input: action.schema.object({
            output: action.schema.string().min(1).max(4096),
            base64: action.schema.string().min(4).max(20_000_000),
          }),
          async execute(value) {
            return writeTavernHistoryExport(value)
          },
        }),
        historyArchive: action({
          input: action.schema.object({
            filename: action.schema.string().min(1).max(240),
            base64: action.schema.string().min(4).max(20_000_000),
          }),
          async execute(value) {
            return archiveTavernHistory({ data: input.data!, ...value })
          },
        }),
        quickRepliesList: action({
          input: action.schema.object({}),
          async execute() {
            return loadTavernQuickReplies(input.data!)
          },
        }),
        exportResource: action({
          input: action.schema.object({
            kind: action.schema.enum(["character", "worldbook"]),
            id: action.schema.string().min(1).max(200),
            output: action.schema.string().min(1).max(4096).optional(),
          }),
          async execute(value) {
            if (value.output) return writeTavernExport({ data: input.data!, kind: value.kind, id: value.id, output: value.output })
            return exportTavernResource({ data: input.data!, ...value })
          },
        }),
        ttsStatus: action({
          input: action.schema.object({}),
          async execute() {
            const config = await readTtsConfig(input.data!)
            return {
              config,
              secureStorage: secureStorage?.status() ?? "unavailable",
              hasSecret: Boolean(await secureStorage?.get("tts.openai-compatible.api-key")),
            }
          },
        }),
        ttsConfigure: action({
          input: action.schema.object({
            baseUrl: action.schema.string().url().max(500).optional(),
            model: action.schema.string().min(1).max(200).optional(),
            voice: action.schema.string().min(1).max(120).optional(),
            apiKey: action.schema.string().min(1).max(8192).optional(),
            clearApiKey: action.schema.boolean().optional(),
          }),
          async execute(value) {
            if (!secureStorage) throw new Error("Tavern TTS requires secure credential storage")
            if (value.apiKey) await secureStorage.set("tts.openai-compatible.api-key", value.apiKey)
            if (value.clearApiKey) await secureStorage.remove("tts.openai-compatible.api-key")
            const config = {
              baseUrl: value.baseUrl?.trim() || ttsDefaults.baseUrl,
              model: value.model?.trim() || ttsDefaults.model,
              voice: value.voice?.trim() || ttsDefaults.voice,
            } satisfies TavernTtsConfig
            await writeTtsConfig(input.data!, config)
            return {
              config,
              secureStorage: secureStorage.status(),
              hasSecret: Boolean(await secureStorage.get("tts.openai-compatible.api-key")),
            }
          },
        }),
        ttsSynthesize: action({
          input: action.schema.object({ text: action.schema.string().min(1).max(20_000), provider: action.schema.enum(["openai-compatible", "mimo"]).optional() }),
          async execute(value) {
            if (!secureStorage) throw new Error("Tavern TTS requires secure credential storage")
            const apiKey = await secureStorage.get("tts.openai-compatible.api-key")
            if (!apiKey) throw new Error("请先在酒馆设置中保存 TTS API Key")
            const config = await readTtsConfig(input.data!)
            if (value.provider !== "mimo") return { dataUrl: await synthesizeTts({ config, apiKey, text: value.text, model: config.model }) }
            const items = splitMimoTts(value.text)
            const dataUrls = await items.reduce(async (result, item) => {
              const urls = await result
              const preferred = item.dialogue ? config.model || "mimo-v2.5-tts-voicedesign" : "mimo-v2.5-tts"
              const audio = await synthesizeTts({ config, apiKey, text: item.text, model: preferred }).catch(async (cause) => {
                if (!item.dialogue || preferred === "mimo-v2.5-tts") throw cause
                return await synthesizeTts({ config, apiKey, text: item.text, model: "mimo-v2.5-tts" })
              })
              return [...urls, audio]
            }, Promise.resolve([] as string[]))
            return { dataUrls }
          },
        }),
        memoryStatus: action({
          input: action.schema.object({}),
          async execute() {
            const config = await readTavernEmbeddingConfig(input.data!)
            const store = await readTavernMemoryStore(input.data!)
            return {
              config,
              secureStorage: secureStorage?.status() ?? "unavailable",
              hasSecret: Boolean(await secureStorage?.get("memory.openai-compatible.api-key")),
              indexed: store.entries.filter((entry) => entry.embedding?.length).length,
              pending: store.entries.filter((entry) => !entry.embedding?.length).length,
            }
          },
        }),
        memoryConfigure: action({
          input: action.schema.object({
            baseUrl: action.schema.string().url().max(500).optional(),
            model: action.schema.string().min(1).max(200).optional(),
            apiKey: action.schema.string().min(1).max(8192).optional(),
            clearApiKey: action.schema.boolean().optional(),
          }),
          async execute(value) {
            if (!secureStorage) throw new Error("Tavern memory requires secure credential storage")
            if (value.apiKey) await secureStorage.set("memory.openai-compatible.api-key", value.apiKey)
            if (value.clearApiKey) await secureStorage.remove("memory.openai-compatible.api-key")
            const config = normalizeTavernEmbeddingConfig(value)
            await writeTavernEmbeddingConfig(input.data!, config)
            return {
              config,
              secureStorage: secureStorage.status(),
              hasSecret: Boolean(await secureStorage.get("memory.openai-compatible.api-key")),
            }
          },
        }),
        memoryList: action({
          input: action.schema.object({
            projectID: action.schema.string().min(1).max(200),
            conversationID: action.schema.string().min(1).max(200),
          }),
          async execute(value) {
            await assertTavernMemoryScope(input.data!, value.conversationID, value.projectID)
            const store = await readTavernMemoryStore(input.data!)
            return store.entries
              .filter((entry) => entry.projectID === value.projectID && (entry.layer === "project" || entry.conversationID === value.conversationID))
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .slice(0, 100)
              .map(({ embedding, ...entry }) => ({ ...entry, indexed: Boolean(embedding?.length) }))
          },
        }),
        memoryWrite: action({
          input: action.schema.object({
            id: action.schema.string().uuid().optional(),
            projectID: action.schema.string().min(1).max(200),
            conversationID: action.schema.string().min(1).max(200),
            layer: action.schema.enum(["project", "conversation"]),
            content: action.schema.string().min(1).max(8_000),
            source: action.schema.enum(["manual", "summary"]).optional(),
          }),
          async execute(value) {
            await assertTavernMemoryScope(input.data!, value.conversationID, value.projectID)
            const store = await readTavernMemoryStore(input.data!)
            const previous = value.id ? store.entries.find((entry) => entry.id === value.id) : undefined
            if (previous && (previous.projectID !== value.projectID || previous.layer !== value.layer || previous.conversationID !== value.conversationID)) {
              throw new Error("Tavern memory scope cannot be changed by update")
            }
            const now = Date.now()
            const entry = normalizeTavernMemoryEntry({
              id: value.id ?? crypto.randomUUID(),
              projectID: value.projectID,
              conversationID: value.layer === "conversation" ? value.conversationID : undefined,
              layer: value.layer,
              content: value.content,
              source: value.source,
              createdAt: previous?.createdAt ?? now,
              updatedAt: now,
            })!
            const apiKey = await secureStorage?.get("memory.openai-compatible.api-key")
            const config = await readTavernEmbeddingConfig(input.data!)
            const indexed = apiKey
              ? await createTavernEmbedding({ config, apiKey, text: entry.content }).catch(() => undefined)
              : undefined
            const next = { ...entry, embedding: indexed }
            await writeTavernMemoryStore(input.data!, { entries: [...store.entries.filter((item) => item.id !== next.id), next] })
            return { id: next.id, indexed: Boolean(indexed), reason: indexed ? undefined : "embedding-unavailable" }
          },
        }),
        memoryDelete: action({
          input: action.schema.object({
            id: action.schema.string().uuid(),
            projectID: action.schema.string().min(1).max(200),
            conversationID: action.schema.string().min(1).max(200),
          }),
          async execute(value) {
            await assertTavernMemoryScope(input.data!, value.conversationID, value.projectID)
            const store = await readTavernMemoryStore(input.data!)
            const matched = store.entries.find((entry) => entry.id === value.id && entry.projectID === value.projectID && (entry.layer === "project" || entry.conversationID === value.conversationID))
            if (!matched) return { deleted: false }
            await writeTavernMemoryStore(input.data!, { entries: store.entries.filter((entry) => entry.id !== value.id) })
            return { deleted: true }
          },
        }),
        memoryReindex: action({
          input: action.schema.object({
            projectID: action.schema.string().min(1).max(200),
            conversationID: action.schema.string().min(1).max(200),
          }),
          async execute(value) {
            await assertTavernMemoryScope(input.data!, value.conversationID, value.projectID)
            const apiKey = await secureStorage?.get("memory.openai-compatible.api-key")
            if (!apiKey) return { status: "unavailable" as const, indexed: 0, pending: 0 }
            const config = await readTavernEmbeddingConfig(input.data!)
            const store = await readTavernMemoryStore(input.data!)
            const candidates = store.entries
              .filter((entry) => entry.projectID === value.projectID && (entry.layer === "project" || entry.conversationID === value.conversationID) && !entry.embedding?.length)
              .slice(0, 25)
            const embeddings = await Promise.all(candidates.map(async (entry) => ({ id: entry.id, embedding: await createTavernEmbedding({ config, apiKey, text: entry.content }).catch(() => undefined) })))
            const replacements = new Map(embeddings.filter((item): item is { id: string; embedding: number[] } => Boolean(item.embedding)).map((item) => [item.id, item.embedding]))
            await writeTavernMemoryStore(input.data!, { entries: store.entries.map((entry) => {
              const embedding = replacements.get(entry.id)
              return embedding ? { ...entry, embedding } : entry
            }) })
            return {
              status: "ok" as const,
              indexed: replacements.size,
              pending: Math.max(0, candidates.length - replacements.size),
            }
          },
        }),
        memoryRecall: action({
          input: action.schema.object({
            projectID: action.schema.string().min(1).max(200),
            conversationID: action.schema.string().min(1).max(200),
            query: action.schema.string().min(1).max(8_000),
            limit: action.schema.number().int().min(1).max(8).optional(),
          }),
          async execute(value) {
            await assertTavernMemoryScope(input.data!, value.conversationID, value.projectID)
            const apiKey = await secureStorage?.get("memory.openai-compatible.api-key")
            if (!apiKey) return { status: "unavailable" as const, results: [] }
            const config = await readTavernEmbeddingConfig(input.data!)
            const embedding = await createTavernEmbedding({ config, apiKey, text: value.query }).catch(() => undefined)
            if (!embedding) return { status: "unavailable" as const, results: [] }
            const store = await readTavernMemoryStore(input.data!)
            return {
              status: "ok" as const,
              results: rankTavernMemories({ entries: store.entries, projectID: value.projectID, conversationID: value.conversationID, embedding, limit: value.limit ?? 3 }).map((item) => ({
                id: item.entry.id,
                layer: item.entry.layer,
                content: item.entry.content,
                score: item.score,
              })),
            }
          },
        }),
      },
    }
  },
})

async function readTtsConfig(data: string): Promise<TavernTtsConfig> {
  const text = await readFile(path.join(data, "tts.json"), "utf8").catch(() => undefined)
  if (!text) return ttsDefaults
  try {
    const value = JSON.parse(text) as Partial<TavernTtsConfig>
    return {
      baseUrl: typeof value.baseUrl === "string" && value.baseUrl ? value.baseUrl : ttsDefaults.baseUrl,
      model: typeof value.model === "string" && value.model ? value.model : ttsDefaults.model,
      voice: typeof value.voice === "string" && value.voice ? value.voice : ttsDefaults.voice,
    }
  } catch {
    return ttsDefaults
  }
}

async function writeTtsConfig(data: string, config: TavernTtsConfig) {
  const target = path.join(data, "tts.json")
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await mkdir(data, { recursive: true })
  await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", "utf8")
  await rename(temporary, target)
}

async function synthesizeTts(input: { config: TavernTtsConfig; apiKey: string; text: string; model: string }) {
  const response = await fetch(`${input.config.baseUrl.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ model: input.model, voice: input.config.voice, input: input.text, response_format: "mp3" }),
  })
  if (!response.ok) throw new Error(`TTS 请求失败 (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error("TTS 音频响应无效或过大")
  const mime = response.headers.get("content-type")?.split(";")[0] || "audio/mpeg"
  if (!mime.startsWith("audio/")) throw new Error("TTS 服务未返回音频")
  return `data:${mime};base64,${bytes.toString("base64")}`
}

export function splitMimoTts(text: string) {
  return text.match(/“[^”]+”|"[^"]+"|[^“”"]+/g)?.map((item) => ({ text: item.trim(), dialogue: /^(?:“.*”|".*")$/.test(item.trim()) })).filter((item) => item.text) ?? []
}

async function assertTavernMemoryScope(data: string, conversationID: string, projectID: string) {
  const text = await readFile(path.join(data, "ui.json"), "utf8").catch(() => "")
  if (!text) throw new Error("Tavern memory session binding is unavailable")
  try {
    const value = JSON.parse(text) as { sessions?: Record<string, { characterID?: unknown; groupID?: unknown }> }
    const binding = value.sessions?.[conversationID]
    const expected = typeof binding?.groupID === "string"
      ? `group:${binding.groupID}`
      : typeof binding?.characterID === "string"
        ? `character:${binding.characterID}`
        : undefined
    if (expected !== projectID) throw new Error("Tavern memory scope does not match this conversation")
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error("Tavern memory session binding is invalid")
  }
}
