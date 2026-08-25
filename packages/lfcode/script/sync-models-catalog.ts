import { ensureBundledModelsCatalog, writeBundledModelsCatalog } from "./models-catalog"

const source = process.env.LFCODE_MODELS_URL || "https://models.dev"
const endpoint = source.endsWith("/api.json") ? source : `${source.replace(/\/$/, "")}/api.json`
const response = await fetch(endpoint, {
  headers: { "User-Agent": "Lfcode models catalog sync" },
  signal: AbortSignal.timeout(30_000),
})

if (!response.ok) throw new Error(`models catalog request failed with ${response.status}`)

const text = await response.text()
const catalog = JSON.parse(text)
preserveCompatibilityModels(catalog)
const metadata = await writeBundledModelsCatalog({ catalog, source: endpoint })
await ensureBundledModelsCatalog()
console.log(`Synced ${metadata.models} models from ${metadata.providers} providers (${metadata.sha256})`)

function preserveCompatibilityModels(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const catalog = value as Record<string, { models?: Record<string, Record<string, unknown>>; [key: string]: unknown }>

  // Keep stable aliases used by existing configurations when models.dev retires
  // or renames a model ID. The canonical capability data still comes from the
  // current online entry that each alias is cloned from.
  const openai = catalog.openai
  if (openai?.models && !openai.models["gpt-5-codex"]) {
    const source = openai.models["gpt-5.3-codex"] ?? openai.models["gpt-5.4"] ?? openai.models["gpt-5"]
    if (source) openai.models["gpt-5-codex"] = { ...source, id: "gpt-5-codex", name: "GPT-5-Codex" }
  }

  if (!catalog["github-models"]) {
    catalog["github-models"] = {
      id: "github-models",
      env: ["GITHUB_TOKEN"],
      npm: "@ai-sdk/openai-compatible",
      api: "https://models.github.ai/inference",
      name: "GitHub Models",
      doc: "https://docs.github.com/en/github-models",
      models: {},
    }
  }
  const github = catalog["github-models"]
  github.models ??= {}
  const phi = github.models["microsoft/phi-4-mini-instruct"] ?? {
    id: "microsoft/phi-4-mini-instruct",
    name: "Phi-4-mini-instruct",
    family: "phi",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 128_000, output: 4_096 },
  }
  github.models["microsoft/phi-4-mini-instruct"] = phi
  github.models["microsoft/phi-4-mini"] = { ...phi, id: "microsoft/phi-4-mini", name: "Phi-4-mini" }
  if (!github.models["ai21-labs/ai21-jamba-1.5-large"]) {
    github.models["ai21-labs/ai21-jamba-1.5-large"] = {
      id: "ai21-labs/ai21-jamba-1.5-large",
      name: "AI21 Jamba 1.5 Large",
      family: "jamba",
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      modalities: { input: ["text"], output: ["text"] },
      open_weights: false,
      limit: { context: 256_000, output: 4_096 },
    }
  }
}
