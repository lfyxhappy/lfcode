import { snapshot } from "../../lfcode/src/provider/models-snapshot.js"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

type SnapshotModel = {
  reasoning?: boolean
  tool_call?: boolean
  temperature?: boolean
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; output?: number }
  reasoning_options?: Array<{ type?: string; values?: string[]; min?: number; max?: number }>
}

type SnapshotRow = { provider: string; id: string; model: SnapshotModel }

const officialProviders = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "zhipuai",
  "zai",
  "zhipuai-coding-plan",
  "zai-coding-plan",
  "moonshotai",
  "moonshotai-cn",
  "xai",
  "alibaba",
  "alibaba-cn",
  "mistral",
  "cohere",
  "perplexity",
  "amazon-bedrock",
  "stepfun",
  "stepfun-step-plan",
  "stepfun-ai-step-plan",
  "minimax",
])

const rows: SnapshotRow[] = Object.entries(snapshot).flatMap(([provider, item]) =>
  Object.entries((item as { models?: Record<string, SnapshotModel> }).models ?? {}).map(([id, model]) => ({
    provider,
    id,
    model,
  })),
)

const groups = new Map<string, SnapshotRow[]>()
for (const row of rows) {
  const key = normalize(row.id)
  const group = groups.get(key) ?? []
  group.push(row)
  groups.set(key, group)
}

const catalog: Record<string, {
  r: boolean
  i: string[]
  o: string[]
  c: number
  x: number
  v: boolean
  t: boolean
  m?: Array<{ type: string; values?: string[]; min?: number; max?: number }>
}> = {}

for (const group of groups.values()) {
  const selected = selectCanonical(group)
  const modeSource = selected.model.reasoning_options?.length
    ? selected
    : group.filter((row) => row.model.reasoning_options?.length).sort((left, right) => score(right) - score(left))[0] ?? selected
  const input = selected.model.modalities?.input ?? ["text"]
  const output = selected.model.modalities?.output ?? ["text"]
  const context = selected.model.limit?.context && selected.model.limit.context > 0
    ? selected.model.limit.context
    : Math.max(...group.map((row) => row.model.limit?.context ?? 0), 128_000)
  const outputLimit = selected.model.limit?.output && selected.model.limit.output > 0
    ? selected.model.limit.output
    : Math.max(...group.map((row) => row.model.limit?.output ?? 0), 16_000)
  const modes = modeSource.model.reasoning_options?.filter((option) => option.type).map((option) => ({
    type: option.type ?? "unknown",
    ...(Array.isArray(option.values)
      ? { values: option.values.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(option.min !== undefined ? { min: option.min } : {}),
    ...(option.max !== undefined ? { max: option.max } : {}),
  }))
  catalog[normalize(selected.id)] = {
    r: selected.model.reasoning === true,
    i: input,
    o: output,
    c: context,
    x: outputLimit,
    v: selected.model.temperature !== false,
    t: selected.model.tool_call === true,
    ...(modes?.length ? { m: modes } : {}),
  }
}

const output = `// Generated from packages/lfcode/src/provider/models-snapshot.js. Do not edit by hand.\nexport type ModelNameCatalogMode = { type: string; values?: string[]; min?: number; max?: number }\nexport type ModelNameCatalogEntry = { r: boolean; i: string[]; o: string[]; c: number; x: number; v: boolean; t: boolean; m?: ModelNameCatalogMode[] }\nexport const MODEL_NAME_CATALOG: Record<string, ModelNameCatalogEntry> = ${JSON.stringify(catalog)}\n`
await writeFile(fileURLToPath(new URL("../src/model-name-catalog.ts", import.meta.url)), output)

function normalize(value: string) {
  return value.toLowerCase().split("/").pop()?.replace(/[^a-z0-9]/g, "") ?? ""
}

function selectCanonical(group: SnapshotRow[]) {
  return [...group].sort((left, right) => score(right) - score(left))[0]
}

function score(row: SnapshotRow) {
  const id = row.id.toLowerCase()
  const provider = row.provider.toLowerCase()
  let value = 0
  if (officialProviders.has(provider)) value += 200
  if (provider === "opencode" || provider === "opencode-go") value += 150
  if (/mimo/.test(id) && provider.startsWith("xiaomi")) value += 500
  if (/deepseek/.test(id) && provider === "deepseek") value += 500
  if (/(?:glm|chatglm|zhipu)/.test(id) && (provider.includes("zhipu") || provider === "zai")) value += 500
  if (/kimi|moonshot/.test(id) && provider.startsWith("moonshot")) value += 500
  if (/qwen|qwq/.test(id) && provider.startsWith("alibaba")) value += 500
  if (/claude|anthropic/.test(id) && provider === "anthropic") value += 500
  if (/(?:gemini|gemma)/.test(id) && provider === "google") value += 500
  if (/(?:gpt|openai|codex|\\bo[1-9])/.test(id) && provider === "openai") value += 500
  if (/grok/.test(id) && provider === "xai") value += 500
  if (/mistral|pixtral|devstral|codestral/.test(id) && provider === "mistral") value += 500
  if (/step/.test(id) && provider.startsWith("stepfun")) value += 500
  if (row.model.reasoning_options?.some((option) => option.type === "effort" && option.values?.length)) value += 20
  return value
}
