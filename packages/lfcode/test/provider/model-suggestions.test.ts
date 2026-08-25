import { expect, test } from "bun:test"
import {
  mergeSuggestion,
  suggestModel,
  suggestModelWithOnlineCatalog,
  suggestModelWithOnlineFallback,
} from "../../src/provider/model-suggestions"
import type { Provider as CatalogProvider } from "../../src/provider/models"
import { ensureBundledModelsCatalog } from "../../script/models-catalog"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"

const catalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: [],
    models: {
      "gpt-5.6": {
        id: "gpt-5.6",
        name: "GPT-5.6",
        release_date: "2026-07-09",
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        temperature: false,
        tool_call: true,
        limit: { context: 1_050_000, output: 128_000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        cost: { input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 },
      },
    },
  },
} satisfies Record<string, CatalogProvider>

test("model suggestions prefer provider and model catalog matches", () => {
  const result = suggestModel({ providerID: "openai", modelID: "gpt-5.6", catalog })
  expect(result.source).toBe("catalog")
  expect(result.patch.capabilities?.reasoning).toBe(true)
  expect(result.patch.limit?.context).toBe(1_050_000)
  expect(result.patch.modalities?.input).toEqual(["text", "image", "pdf"])
  expect(result.patch.cost).toEqual({ input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 })
  expect(result.patch.reasoningOptions).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
  expect(result.patch.variantOptions).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
})

test("model suggestions support display-name aliases and explicit manual precedence", () => {
  const alias = suggestModel({ providerID: "openai", modelID: "GPT_5.6_latest", displayName: "GPT-5.6", catalog })
  expect(alias.source).toBe("alias")
  expect(alias.patch.capabilities?.temperature).toBe(false)
  const merged = mergeSuggestion(
    { capabilities: { reasoning: false, temperature: true } },
    alias.patch,
    new Set(["capabilities"]),
  )
  expect(merged.capabilities).toEqual({ reasoning: false, temperature: true })
})

test("unknown custom models get conservative inference warnings", () => {
  const result = suggestModel({ providerID: "custom", modelID: "my-gpt-5-coding" })
  expect(result.source).toBe("inferred")
  expect(result.warning).toContain("未找到目录信息")
  expect(result.patch.capabilities?.reasoning).toBe(true)
})

test("OpenCode Go models infer capabilities from their model name", async () => {
  const result = suggestModel({ providerID: "opencode-go", modelID: "deepseek-reasoner" })
  expect(result.source).toBe("inferred")
  expect(result.patch.capabilities?.reasoning).toBe(true)
  expect(result.patch.capabilities?.tool_call).toBe(true)

  const online = {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      env: [],
      models: {
        "deepseek-reasoner": {
          id: "deepseek-reasoner",
          name: "DeepSeek Reasoner",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          limit: { context: 128_000, output: 16_000 },
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
  } satisfies Record<string, CatalogProvider>
  const fallback = await suggestModelWithOnlineCatalog(
    { providerID: "opencode-go", modelID: "deepseek-reasoner", catalog: {} },
    online,
  )
  expect(fallback.patch.capabilities?.reasoning).toBe(true)
  expect(fallback.matchedProviderID).toBe("deepseek")
})

test("missing local models are resolved from the online catalog", async () => {
  const online = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: [],
      models: {
        "claude-sonnet-4-6": {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          release_date: "2026-02-17",
          attachment: true,
          reasoning: true,
          reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
          temperature: true,
          tool_call: true,
          limit: { context: 1_000_000, output: 64_000 },
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        },
      },
    },
  } satisfies Record<string, CatalogProvider>

  let calls = 0
  const result = await suggestModelWithOnlineFallback(
    { providerID: "anthropic", modelID: "claude-sonnet-4-6", catalog },
    async () => {
      calls += 1
      return online
    },
  )
  expect(calls).toBe(1)
  expect(result.source).toBe("online")
  expect(result.patch.capabilities?.image).toBe(true)
  expect(result.warning).toContain("在线 Models.dev")
})

test("online fallback keeps reasoning toggles and can use a unique cross-provider match", async () => {
  const online = {
    alibaba: {
      id: "alibaba",
      name: "Alibaba",
      env: [],
      models: {
        "qwen3-omni-flash": {
          id: "qwen3-omni-flash",
          name: "Qwen3 Omni Flash",
          release_date: "2026-04-01",
          attachment: true,
          reasoning: true,
          reasoning_options: [{ type: "toggle" }],
          temperature: true,
          tool_call: true,
          limit: { context: 262_144, output: 32_768 },
          modalities: { input: ["text", "image", "audio"], output: ["text"] },
        },
      },
    },
  } satisfies Record<string, CatalogProvider>

  const result = await suggestModelWithOnlineFallback(
    { providerID: "custom", modelID: "qwen3-omni-flash", catalog: {} },
    async () => online,
  )
  expect(result.source).toBe("online")
  expect(result.matchedProviderID).toBe("alibaba")
  expect(result.patch.reasoningOptions).toBeUndefined()
  expect(result.patch.reasoningModes).toEqual([{ type: "toggle" }])
})

test("online fallback uses a custom provider name to resolve duplicate mainstream model IDs", () => {
  const online = {
    openai: {
      id: "openai",
      name: "OpenAI",
      env: [],
      models: {
        "gpt-5.5": {
          id: "gpt-5.5",
          name: "GPT-5.5",
          release_date: "2026-07-01",
          attachment: true,
          reasoning: true,
          temperature: false,
          tool_call: true,
          limit: { context: 1_050_000, output: 128_000 },
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        },
      },
    },
    gateway: {
      id: "gateway",
      name: "Gateway",
      env: [],
      models: {
        "gpt-5.5": {
          id: "gpt-5.5",
          name: "GPT-5.5",
          release_date: "2026-07-01",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: false,
          limit: { context: 128_000, output: 16_384 },
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
  } satisfies Record<string, CatalogProvider>

  const result = suggestModelWithOnlineCatalog(
    { providerID: "my-openai", providerName: "My OpenAI", modelID: "gpt-5.5", catalog: {} },
    online,
  )
  expect(result.source).toBe("online")
  expect(result.matchedProviderID).toBeUndefined()
  expect(result.patch.limit?.context).toBe(1_050_000)
})

test("online catalog failures keep the local inference and warning", async () => {
  const result = await suggestModelWithOnlineFallback(
    { providerID: "custom", modelID: "my-gpt-5-coding" },
    async () => {
      throw new Error("network unavailable")
    },
  )
  expect(result.source).toBe("inferred")
  expect(result.warning).toContain("在线目录查询失败")
})

test("local mainstream provider coverage remains broad", async () => {
  const snapshot = await ensureBundledModelsCatalog()
  const required = {
    openai: ["gpt-5-codex"],
    anthropic: ["claude-sonnet-4-6"],
    google: ["gemini-3.5-flash"],
    mistral: ["mistral-small-2506"],
    xai: ["grok-4.5"],
    deepseek: ["deepseek-reasoner"],
    alibaba: ["qwen3-coder-flash"],
    zhipuai: ["glm-5"],
    moonshotai: ["kimi-k2.7-code"],
    groq: ["llama-3.3-70b-versatile"],
    perplexity: ["sonar-pro"],
    openrouter: ["openai/gpt-4o"],
    "amazon-bedrock": ["us.anthropic.claude-opus-4-7"],
    azure: ["gpt-5-codex"],
    "github-copilot": ["gpt-5.4"],
  }
  for (const [providerID, modelIDs] of Object.entries(required)) {
    const provider = snapshot.catalog[providerID] as CatalogProvider | undefined
    expect(provider).toBeDefined()
    if (!provider) throw new Error(`missing provider ${providerID}`)
    for (const modelID of modelIDs) expect(provider.models[modelID]).toBeDefined()
  }

  const modelIDs = Object.values(snapshot.catalog as Record<string, CatalogProvider>).flatMap((provider) =>
    Object.keys(provider.models),
  )
  const mainstreamFamilies = [
    /gpt|(?:^|[-/])o[1-4](?:[-./]|$)/i,
    /claude/i,
    /gemini|gemma/i,
    /grok/i,
    /deepseek/i,
    /qwen|qwq/i,
    /glm/i,
    /kimi/i,
    /minimax/i,
    /mistral|codestral|devstral|magistral/i,
    /llama/i,
    /command/i,
    /sonar/i,
    /nova/i,
    /phi/i,
    /nemotron/i,
    /step-/i,
    /mimo/i,
    /hunyuan/i,
    /ernie/i,
    /doubao|seed/i,
    /jamba/i,
  ]
  for (const family of mainstreamFamilies) expect(modelIDs.some((id) => family.test(id))).toBe(true)

  const ambiguous = await suggestModelWithOnlineFallback(
    { providerID: "custom", modelID: "gpt-5.5", catalog: {} },
    async () => snapshot.catalog as Record<string, CatalogProvider>,
  )
  expect(ambiguous.source).toBe("online")
  expect(ambiguous.warning).toContain("供应商版本")
  expect(ambiguous.candidates?.length).toBeGreaterThan(1)
  expect(ambiguous.patch.capabilities?.text).toBe(true)
})

test("mainstream model identities keep provider-independent inferred metadata", async () => {
  const snapshot = await ensureBundledModelsCatalog()
  const matrix = [
    ["openai", "gpt-5.4"],
    ["anthropic", "claude-sonnet-4-6"],
    ["google", "gemini-3.5-flash"],
    ["mistral", "mistral-small-2506"],
    ["xai", "grok-4.5"],
    ["deepseek", "deepseek-reasoner"],
    ["alibaba", "qwen3-coder-flash"],
    ["zhipuai", "glm-5"],
    ["moonshotai", "kimi-k2.7-code"],
    ["minimax", "MiniMax-M2.7"],
    ["cohere", "command-a-reasoning-08-2025"],
    ["perplexity", "sonar-pro"],
    ["stepfun", "step-3.7-flash"],
    ["tencent-coding-plan", "hunyuan-2.0-thinking"],
    ["nano-gpt", "ernie-5.1"],
    ["nano-gpt", "doubao-seed-1-6-250615"],
    ["github-models", "microsoft/phi-4-mini-instruct"],
    ["github-models", "ai21-labs/ai21-jamba-1.5-large"],
    ["nova", "nova-2-pro-v1"],
  ] as const
  for (const [providerID, modelID] of matrix) {
    const provider = snapshot.catalog[providerID] as CatalogProvider | undefined
    expect(provider).toBeDefined()
    const result = suggestModel({ providerID, modelID, catalog: snapshot.catalog as Record<string, CatalogProvider> })
    expect(result.source).toBe("catalog")
    const profile = inferModelProfile({ modelID })
    expect(result.patch.capabilities?.reasoning).toBe(profile.capabilities.reasoning)
    expect(result.patch.modalities?.input).toEqual(profile.modalities.input)
    expect(result.patch.limit?.context).toBe(profile.limit.context)
  }
})

test("bundled catalog and metadata are self-contained and valid", async () => {
  const snapshot = await ensureBundledModelsCatalog()
  expect(snapshot.metadata.source).toBe("https://models.dev/api.json")
  expect(snapshot.metadata.models).toBeGreaterThan(5_000)
  expect(snapshot.catalog.openai).toBeDefined()
})

test("malformed online catalogs are rejected before replacing the snapshot", async () => {
  process.env.LFCODE_DISABLE_MODELS_FETCH = "1"
  const { validateOnlineModelsCatalog } = await import("../../src/provider/models")
  expect(validateOnlineModelsCatalog({})).toBe(false)
  expect(
    validateOnlineModelsCatalog({
      openai: { models: { "gpt-5": {} } },
      anthropic: { models: {} },
      google: { models: {} },
    }),
  ).toBe(false)
  const minimal = { id: "model", name: "Model", limit: { context: 1, output: 1 } }
  expect(
    validateOnlineModelsCatalog({
      openai: { models: { "gpt-5": {} } },
      anthropic: { models: { claude: minimal } },
      google: { models: { gemini: minimal } },
    }),
  ).toBe(false)
  const snapshot = await ensureBundledModelsCatalog()
  expect(validateOnlineModelsCatalog(snapshot.catalog)).toBe(true)
})
