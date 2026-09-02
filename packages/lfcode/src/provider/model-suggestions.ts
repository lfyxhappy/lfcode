import type { Model as CatalogModel, Provider as CatalogProvider } from "./models"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"

export type ModelSuggestionSource = "catalog" | "alias" | "online" | "inferred" | "none"

export type ModelSuggestionPatch = {
  capabilities?: Partial<
    Record<
      | "text"
      | "image"
      | "audio"
      | "video"
      | "pdf"
      | "attachment"
      | "reasoning"
      | "temperature"
      | "tool_call"
      | "patch_editing"
      | "native_web",
      boolean
    >
  >
  limit?: { context?: number; input?: number; output?: number }
  modalities?: { input: string[]; output: string[] }
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  reasoningOptions?: string[]
  reasoningModes?: Array<{ type: string; values?: string[]; min?: number; max?: number }>
  variantGroup?: "custom"
  variantOptions?: string[]
}

export type ModelSuggestionCandidate = {
  providerID: string
  providerName: string
  modelID: string
  displayName: string
  patch: ModelSuggestionPatch
}

export type ModelSuggestion = {
  providerID: string
  modelID: string
  displayName: string
  source: ModelSuggestionSource
  patch: ModelSuggestionPatch
  warning?: string
  sourceUpdatedAt?: string
  sourceUrl?: string
  matchedProviderID?: string
  candidates?: ModelSuggestionCandidate[]
}

export type ModelCatalogMatch = {
  providerID: string
  providerName: string
  modelID: string
  displayName: string
}

type SuggestionInput = {
  providerID: string
  modelID: string
  displayName?: string
  providerName?: string
  catalog?: Record<string, CatalogProvider>
}

type CatalogMatch = {
  model: CatalogModel
  source: "catalog" | "alias"
}

export function matchModelsInCatalog(input: {
  providerID: string
  query: string
  catalog: Record<string, CatalogProvider>
  limit?: number
}): ModelCatalogMatch[] {
  const query = normalizeModelKey(input.query)
  if (query.length < 2) return []
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  return Object.entries(input.catalog)
    .flatMap(([providerID, provider]) =>
      Object.entries(provider.models).flatMap(([modelID, model]) => {
        const values = [modelID, model.id, model.name].map(normalizeModelKey)
        const index = values.findIndex((value) => value === query)
        const contains = values.some((value) => value.includes(query))
        if (!contains) return []
        return [
          {
            providerID,
            providerName: provider.name,
            modelID: model.id || modelID,
            displayName: model.name || model.id || modelID,
            score: index >= 0 ? 0 : values.findIndex((value) => value.includes(query)),
            priority: providerID === input.providerID ? 0 : 1,
          },
        ]
      }),
    )
    .sort((a, b) => a.priority - b.priority || a.score - b.score || a.modelID.localeCompare(b.modelID))
    .slice(0, limit)
    .map(({ providerID, providerName, modelID, displayName }) => ({ providerID, providerName, modelID, displayName }))
}

export function suggestModel(input: SuggestionInput): ModelSuggestion {
  const displayName = input.displayName?.trim() || input.modelID
  const match = findCatalogMatch(input.catalog?.[input.providerID], input.modelID, displayName)
  if (match) return fromCatalog(input.providerID, input.modelID, displayName, match.model, match.source)

  const patch = inferPatch(input.modelID, displayName)
  if (Object.keys(patch).length > 0) {
    return {
      providerID: input.providerID,
      modelID: input.modelID,
      displayName,
      source: "inferred",
      patch,
      warning: "未找到目录信息，以下能力由模型名称推断，请确认后保存。",
    }
  }

  return {
    providerID: input.providerID,
    modelID: input.modelID,
    displayName,
    source: "none",
    patch: {},
    warning: "未找到目录信息，无法安全推断模型能力。",
  }
}

export function suggestModelWithOnlineCatalog(
  input: SuggestionInput,
  onlineCatalog?: Record<string, CatalogProvider>,
  options?: { authoritative?: boolean },
) {
  const local = suggestModel(input)
  if (!onlineCatalog) return local

  const displayName = input.displayName?.trim() || input.modelID
  const match = findCatalogMatch(onlineCatalog[input.providerID], input.modelID, displayName)
  if (match) {
    const result = fromCatalog(input.providerID, input.modelID, displayName, match.model, "online", options?.authoritative)
    return {
      ...result,
      warning: `已从在线 Models.dev 目录匹配${result.sourceUpdatedAt ? `（数据更新于 ${result.sourceUpdatedAt}）` : ""}，保存前请确认当前供应商仍提供该模型。`,
    }
  }

  const global = findGlobalMatches(onlineCatalog, input.modelID, displayName)
  if (global.matches.length === 1) {
    const result = fromCatalog(input.providerID, input.modelID, displayName, global.matches[0].model, "online", options?.authoritative)
    return {
      ...result,
      matchedProviderID: global.matches[0].providerID,
      warning: `在线目录只在供应商 ${global.matches[0].providerID} 下找到该模型，已提供参考能力；保存前请确认当前供应商兼容性。`,
    }
  }

  if (global.matches.length > 1) {
    const candidates = global.matches.slice(0, 16).map(toCandidate)
    return {
      ...local,
      source: "online",
      patch: consensusPatch(candidates.map((candidate) => candidate.patch)),
      candidates,
      warning: `${local.warning ?? "未找到目录信息。"} 在线 Models.dev 找到 ${global.matches.length} 个供应商版本，已仅保留各版本一致的能力；请选择候选或确认当前供应商。`,
    }
  }

  return {
    ...local,
    warning: `${local.warning ?? "未找到目录信息。"} 在线 Models.dev 目录也未找到该模型，请确认模型 ID 和供应商。`,
  }
}

export async function suggestModelWithOnlineFallback(
  input: SuggestionInput,
  loadOnlineCatalog: () => Promise<Record<string, CatalogProvider> | undefined>,
  options?: { preferOnline?: boolean },
) {
  const local = suggestModel(input)
  if (!options?.preferOnline && (local.source === "catalog" || local.source === "alias")) return local

  try {
    const onlineCatalog = await loadOnlineCatalog()
    if (!onlineCatalog) {
      return {
        ...local,
        warning: `${local.warning ?? "未找到目录信息。"} 在线目录暂时不可用，已保留本地建议。`,
      }
    }
    return suggestModelWithOnlineCatalog(input, onlineCatalog, { authoritative: options?.preferOnline })
  } catch {
    return {
      ...local,
      warning: `${local.warning ?? "未找到目录信息。"} 在线目录查询失败，已保留本地建议。`,
    }
  }
}

export function mergeSuggestion<T extends Record<string, unknown>>(
  current: T,
  suggestion: ModelSuggestionPatch,
  manual: ReadonlySet<string> = new Set(),
) {
  const patch = Object.fromEntries(Object.entries(suggestion).filter(([key]) => !manual.has(key))) as Partial<T>
  return { ...current, ...patch }
}

function fromCatalog(
  providerID: string,
  modelID: string,
  displayName: string,
  model: CatalogModel,
  source: Exclude<ModelSuggestionSource, "inferred" | "none">,
  authoritative = false,
): ModelSuggestion {
  // Models.dev is the authoritative metadata source for catalog-backed
  // suggestions. Do not replace its limits/modalities/capabilities with a
  // model-name guess: a newly released alias is exactly where that guess is
  // most likely to be wrong.
  const profile = inferModelProfile({ modelID: model.id, apiID: model.name })
  const modalities = authoritative ? model.modalities : profile.modalities
  const input = modalities?.input
  const output = modalities?.output
  const capabilities = {
    ...(input ? {
      text: input.includes("text"),
      image: input.includes("image"),
      audio: input.includes("audio"),
      video: input.includes("video"),
      pdf: input.includes("pdf"),
    } : {}),
    attachment: authoritative ? model.attachment : profile.capabilities.attachment,
    reasoning: authoritative ? model.reasoning : profile.capabilities.reasoning,
    temperature: authoritative ? model.temperature : profile.capabilities.temperature,
    tool_call: authoritative ? model.tool_call : profile.capabilities.tool_call,
    patch_editing: authoritative ? model.attachment : profile.capabilities.patch_editing,
  }
  const reasoningModes = (authoritative ? model.reasoning_options : profile.reasoningModes)?.map((mode) => ({
    type: mode.type,
    values: mode.values,
  }))
  const reasoningOptions = reasoningModes?.flatMap((mode) => mode.values ?? []) ?? []
  const variantOptions = reasoningOptions.filter((option) =>
    ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(option),
  )
  return {
    providerID,
    modelID,
    displayName,
    source,
    patch: {
      capabilities,
      limit: authoritative ? model.limit : profile.limit,
      ...(input && output ? { modalities: { input, output } } : {}),
      cost: model.cost
        ? {
            input: model.cost.input,
            output: model.cost.output,
            cache_read: model.cost.cache_read,
            cache_write: model.cost.cache_write,
          }
        : undefined,
      reasoningOptions: reasoningOptions.length > 0 ? reasoningOptions : undefined,
      reasoningModes: reasoningModes && reasoningModes.length > 0 ? reasoningModes : undefined,
      variantGroup: variantOptions.length > 0 ? "custom" : undefined,
      variantOptions: variantOptions.length > 0 ? variantOptions : undefined,
    },
    ...(authoritative
      ? { sourceUpdatedAt: model.last_updated ?? model.release_date ?? undefined, sourceUrl: "https://models.dev/api.json" }
      : {}),
  }
}

type GlobalMatch = { providerID: string; provider: CatalogProvider; model: CatalogModel }

function findGlobalMatches(catalog: Record<string, CatalogProvider>, modelID: string, displayName: string) {
  const target = normalizeModelKey(modelID)
  const label = normalizeModelKey(displayName)
  const exact = Object.entries(catalog).flatMap(([providerID, provider]) =>
    Object.entries(provider.models)
      .filter(([id, model]) => [id, model.id].map(normalizeModelKey).includes(target))
      .map(([, model]) => ({ providerID, provider, model })),
  )
  if (exact.length > 0 || label.length <= 2) return { matches: dedupeGlobalMatches(exact) }
  return {
    matches: dedupeGlobalMatches(
      Object.entries(catalog).flatMap(([providerID, provider]) =>
        Object.entries(provider.models)
          .filter(([id, model]) => [id, model.id, model.name].map(normalizeModelKey).includes(label))
          .map(([, model]) => ({ providerID, provider, model })),
      ),
    ),
  }
}

function dedupeGlobalMatches(matches: GlobalMatch[]) {
  return [
    ...new Map(matches.map((match) => [`${match.providerID}:${normalizeModelKey(match.model.id)}`, match])).values(),
  ]
}

function toCandidate(match: GlobalMatch): ModelSuggestionCandidate {
  const suggestion = fromCatalog(match.providerID, match.model.id, match.model.name, match.model, "online")
  return {
    providerID: match.providerID,
    providerName: match.provider.name,
    modelID: match.model.id,
    displayName: match.model.name,
    patch: suggestion.patch,
  }
}

function consensusPatch(patches: ModelSuggestionPatch[]): ModelSuggestionPatch {
  if (patches.length === 0) return {}
  const patch: ModelSuggestionPatch = {}
  const capabilityKeys = [
    "text",
    "image",
    "audio",
    "video",
    "pdf",
    "attachment",
    "reasoning",
    "temperature",
    "tool_call",
  ] as const
  const capabilities = Object.fromEntries(
    capabilityKeys.flatMap((key) => {
      const values = patches.map((item) => item.capabilities?.[key])
      return values.every((value) => typeof value === "boolean" && value === values[0]) ? [[key, values[0]]] : []
    }),
  ) as ModelSuggestionPatch["capabilities"]
  if (capabilities && Object.keys(capabilities).length > 0) patch.capabilities = capabilities
  const limit = consensusRecord(patches.map((item) => item.limit))
  if (Object.keys(limit).length > 0) patch.limit = limit as ModelSuggestionPatch["limit"]
  const modalities = consensusValue(patches.map((item) => item.modalities))
  if (modalities) patch.modalities = modalities
  const cost = consensusRecord(patches.map((item) => item.cost))
  if (Object.keys(cost).length > 0) patch.cost = cost as ModelSuggestionPatch["cost"]
  const reasoningOptions = consensusValue(patches.map((item) => item.reasoningOptions))
  if (reasoningOptions) patch.reasoningOptions = reasoningOptions
  const reasoningModes = consensusValue(patches.map((item) => item.reasoningModes))
  if (reasoningModes) patch.reasoningModes = reasoningModes
  const variantOptions = consensusValue(patches.map((item) => item.variantOptions))
  if (variantOptions) patch.variantOptions = variantOptions
  const variantGroup = consensusValue(patches.map((item) => item.variantGroup))
  if (variantGroup === "custom") patch.variantGroup = variantGroup
  return patch
}

function consensusRecord(values: Array<Record<string, number | undefined> | undefined>) {
  const keys = [...new Set(values.flatMap((value) => (value ? Object.keys(value) : [])))]
  return Object.fromEntries(
    keys.flatMap((key) => {
      const items = values.map((value) => value?.[key])
      return items.every((value) => typeof value === "number" && value === items[0]) ? [[key, items[0]]] : []
    }),
  )
}

function consensusValue<T>(values: Array<T | undefined>) {
  if (values.some((value) => value === undefined)) return
  const first = JSON.stringify(values[0])
  return values.every((value) => JSON.stringify(value) === first) ? values[0] : undefined
}

function findCatalogMatch(
  provider: CatalogProvider | undefined,
  modelID: string,
  displayName: string,
): CatalogMatch | undefined {
  if (!provider) return
  const exact = provider.models[modelID]
  if (exact) return { model: exact, source: "catalog" }
  const target = normalizeModelKey(modelID)
  const label = normalizeModelKey(displayName)
  const model = Object.entries(provider.models).find(([id, model]) => {
    const candidates = [id, model.id, model.name].map(normalizeModelKey)
    return candidates.includes(target) || (label.length > 2 && candidates.includes(label))
  })?.[1]
  return model ? { model, source: "alias" } : undefined
}

function normalizeModelKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/(?:^|[/_: -])latest$/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

function inferPatch(modelID: string, displayName: string): ModelSuggestionPatch {
  const profile = inferModelProfile({ modelID, apiID: displayName })
  return {
    capabilities: {
      text: profile.capabilities.input.text,
      image: profile.capabilities.input.image,
      audio: profile.capabilities.input.audio,
      video: profile.capabilities.input.video,
      pdf: profile.capabilities.input.pdf,
      attachment: profile.capabilities.attachment,
      reasoning: profile.capabilities.reasoning,
      tool_call: profile.capabilities.tool_call,
      temperature: profile.capabilities.temperature,
      patch_editing: profile.capabilities.patch_editing,
      native_web: profile.capabilities.native_web,
    },
    limit: profile.limit,
    modalities: profile.modalities,
    reasoningOptions: profile.reasoningOptions,
    reasoningModes: profile.reasoningModes,
    ...(profile.reasoningOptions.length > 0
      ? { variantGroup: "custom", variantOptions: profile.reasoningOptions }
      : {}),
  }
}
