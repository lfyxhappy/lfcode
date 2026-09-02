import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { ConfigProvider } from "@/config/provider"
import { Provider } from "@/provider"
import { ModelsDev } from "@/provider"
import { ProviderAuth } from "@/provider"
import { ProviderTransform } from "@/provider"
import { A6Api } from "@/provider/a6api"
import { LfApi } from "@/provider/lfapi"
import { DeepSeekUsage } from "@/provider/deepseek-usage"
import { MiniMaxUsage } from "@/provider/minimax-usage"
import { MoonshotUsage } from "@/provider/moonshot-usage"
import { OpenCodeGo } from "@/provider/opencode-go"
import { OpenCode } from "@/provider/opencode"
import { OpenRouterUsage } from "@/provider/openrouter-usage"
import { ProviderQuota } from "@/provider/quota"
import { SiliconFlowUsage } from "@/provider/siliconflow-usage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Auth } from "@/auth"
import { Flag } from "@/flag/flag"
import { url as serverURL } from "@/server/server"
import { mapValues } from "remeda"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Cause, Effect } from "effect"
import { jsonRequest } from "./trace"
import { generateText, tool } from "ai"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { suggestModelWithOnlineFallback } from "@/provider/model-suggestions"
import { matchModelsInCatalog } from "@/provider/model-suggestions"
import { discoverProviderModels } from "@/provider/model-discovery"
import { NotFoundError } from "@/storage"

const DetectResult = z.object({
  detected: ConfigProvider.Model.zod,
  saved: z.boolean(),
  warnings: z.array(z.string()),
})

const ModelSuggestionCandidate = z.object({
  providerID: z.string(),
  providerName: z.string(),
  modelID: z.string(),
  displayName: z.string(),
  patch: z.record(z.string(), z.unknown()),
})

const ModelSuggestionResult = z.object({
  providerID: z.string(),
  modelID: z.string(),
  displayName: z.string(),
  source: z.enum(["catalog", "alias", "online", "inferred", "none"]),
  patch: z.record(z.string(), z.unknown()),
  warning: z.string().optional(),
  sourceUpdatedAt: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  matchedProviderID: z.string().optional(),
  candidates: z.array(ModelSuggestionCandidate).optional(),
})

const ProviderModelDiscoveryInput = z.object({ providerID: z.string().min(1) })
const ProviderModelDiscoveryResult = z.object({
  source: z.enum(["remote", "specialized"]),
  models: z.array(z.object({ id: z.string(), name: z.string().optional(), protocol: z.string().optional() })),
  warning: z.string().optional(),
  error: z
    .enum(["unsupported", "missing_credentials", "unauthorized", "invalid_response", "network", "unsafe_url"])
    .optional(),
})
const ProviderModelMatchInput = z.object({ providerID: z.string().min(1), query: z.string().min(2) })
const ProviderModelMatchResult = z.object({
  models: z.array(
    z.object({ providerID: z.string(), providerName: z.string(), modelID: z.string(), displayName: z.string() }),
  ),
})

const A6ApiDiscoverInput = z.object({
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe("Temporary A6API key. It is used only for this request and is never stored."),
})

const A6ApiDiscoverResult = A6Api.DiscoverResult
const LfApiDiscoverInput = z.object({
  apiKey: z.string().min(1).optional().describe("Temporary LFAPI key. It is used only for this request and is never stored."),
})
const LfApiDiscoverResult = LfApi.DiscoverResult
const OpenCodeGoDiscoverInput = z.object({
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe("Temporary OpenCode Go key. It is used only for this request and is never stored."),
})
const OpenCodeGoDiscoverResult = OpenCodeGo.DiscoverResult
const OpenCodeDiscoverInput = z.object({
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe("Temporary OpenCode Zen key. It is used only for this request and is never stored."),
})
const OpenCodeDiscoverResult = OpenCode.DiscoverResult
const QuotaUsageResult = ProviderQuota.UsageQueryResult

function discoverA6ApiModels(input: z.infer<typeof A6ApiDiscoverInput>, signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored = input.apiKey || !canUseStoredA6ApiKey() ? undefined : yield* auth.get("a6api").pipe(Effect.orDie)
    return yield* Effect.promise(() =>
      A6Api.discover({
        apiKey: input.apiKey,
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      }),
    )
  })
}

function discoverLfApiModels(input: z.infer<typeof LfApiDiscoverInput>, signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored = input.apiKey || !canUseStoredA6ApiKey() ? undefined : yield* auth.get(LfApi.PROVIDER_ID).pipe(Effect.orDie)
    return yield* Effect.promise(() =>
      LfApi.discover({
        apiKey: input.apiKey,
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      }),
    )
  })
}

function canUseStoredA6ApiKey() {
  if (Flag.LFCODE_SERVER_PASSWORD) return true
  const hostname = serverURL?.hostname
  return !hostname || hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
}

function discoverOpenCodeGoModels(input: z.infer<typeof OpenCodeGoDiscoverInput>, signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored =
      input.apiKey || !canUseStoredA6ApiKey() ? undefined : yield* auth.get(OpenCodeGo.PROVIDER_ID).pipe(Effect.orDie)
    return yield* Effect.promise(async () => {
      const result = await OpenCodeGo.discover({
        apiKey: input.apiKey,
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      })
      if (!result.ok) return result
      const catalog = await ModelsDev.get()
      const models = result.models.map((item) => {
        const metadata = catalog[OpenCodeGo.PROVIDER_ID]?.models[item.id]
        if (!metadata) return item
        return {
          ...item,
          name: metadata.name,
          capabilities: {
            reasoning: metadata.reasoning,
            temperature: metadata.temperature,
            tool_call: metadata.tool_call,
          },
          limit: metadata.limit,
          modalities: metadata.modalities,
          cost: metadata.cost
            ? {
                input: metadata.cost.input,
                output: metadata.cost.output,
                cache_read: metadata.cost.cache_read,
                cache_write: metadata.cost.cache_write,
              }
            : undefined,
          source_updated_at: metadata.last_updated ?? metadata.release_date ?? undefined,
        }
      })
      return { ...result, models }
    })
  })
}

function queryOpenCodeGoUsage(signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored = yield* auth.get(OpenCodeGo.PROVIDER_ID).pipe(Effect.orDie)
    return yield* Effect.promise(async () => {
      const result = await OpenCodeGo.usage({
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      })
      if (!result.ok) return result
      return withQuotaMetadata(
        {
          ok: true,
          usage: {
            windows: [
              { id: "rolling", ...result.usage.rolling },
              { id: "weekly", ...result.usage.weekly },
              { id: "monthly", ...result.usage.monthly },
            ],
          },
        },
        "opencode-go",
      )
    })
  })
}

function discoverOpenCodeModels(input: z.infer<typeof OpenCodeDiscoverInput>, signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored =
      input.apiKey || !canUseStoredA6ApiKey() ? undefined : yield* auth.get(OpenCode.PROVIDER_ID).pipe(Effect.orDie)
    return yield* Effect.promise(() =>
      OpenCode.discover({
        apiKey: input.apiKey,
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      }),
    )
  })
}

function queryOpenCodeUsage(signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored = yield* auth.get(OpenCode.PROVIDER_ID).pipe(Effect.orDie)
    return yield* Effect.promise(async () => {
      const result = await OpenCode.usage({ storedApiKey: stored?.type === "api" ? stored.key : undefined, signal })
      if (!result.ok) return result
      return withQuotaMetadata(
        {
          ok: true,
          usage: {
            windows: [
              { id: "rolling", ...result.usage.rolling },
              { id: "weekly", ...result.usage.weekly },
              { id: "monthly", ...result.usage.monthly },
            ],
          },
        },
        "opencode",
      )
    })
  })
}

function queryMiniMaxUsage(signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const primary = yield* auth.get(MiniMaxUsage.MINIMAX_PROVIDER_ID).pipe(Effect.orDie)
    const legacy = primary ? undefined : yield* auth.get("minimax-cn-coding-plan").pipe(Effect.orDie)
    const stored = primary ?? legacy
    return yield* Effect.promise(async () => {
      const result = await MiniMaxUsage.usage({
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        signal,
      })
      return result.ok ? withQuotaMetadata(result, "minimax") : result
    })
  })
}

function queryDeepSeekUsage(signal: AbortSignal) {
  return queryStoredQuotaUsage(DeepSeekUsage.PROVIDER_ID, signal, (storedApiKey) =>
    DeepSeekUsage.usage({ storedApiKey, signal }),
  )
}

function querySiliconFlowUsage(signal: AbortSignal) {
  return queryStoredQuotaUsage(SiliconFlowUsage.PROVIDER_ID, signal, (storedApiKey) =>
    SiliconFlowUsage.usage({ storedApiKey, signal }),
  )
}

function queryOpenRouterUsage(signal: AbortSignal) {
  return queryStoredQuotaUsage(OpenRouterUsage.PROVIDER_ID, signal, (storedApiKey) =>
    OpenRouterUsage.usage({ storedApiKey, signal }),
  )
}

function queryMoonshotUsage(signal: AbortSignal) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const provider = yield* Provider.Service
    const stored = yield* auth.get(MoonshotUsage.PROVIDER_ID).pipe(Effect.orDie)
    const configured = (yield* provider.list())[ProviderID.make(MoonshotUsage.PROVIDER_ID)]
    const baseURL = typeof configured?.options.baseURL === "string"
      ? configured.options.baseURL
      : Object.values(configured?.models ?? {}).map((model) => model.api.url).find((url) => typeof url === "string")
    return yield* Effect.promise(async () => {
      const result = await MoonshotUsage.usage({
        storedApiKey: stored?.type === "api" ? stored.key : undefined,
        baseURL,
        signal,
      })
      return result.ok ? withQuotaMetadata(result, "moonshotai") : result
    })
  })
}

function queryStoredQuotaUsage(
  providerID: string,
  signal: AbortSignal,
  query: (storedApiKey: string | undefined) => Promise<ProviderQuota.UsageQueryResult>,
) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const stored = yield* auth.get(providerID).pipe(Effect.orDie)
    return yield* Effect.promise(async () => {
      const result = await query(stored?.type === "api" ? stored.key : undefined)
      return result.ok ? withQuotaMetadata(result, providerID) : result
    })
  })
}

function withQuotaMetadata(result: Extract<ProviderQuota.UsageQueryResult, { ok: true }>, source: string) {
  return {
    ok: true as const,
    usage: {
      ...result.usage,
      fetchedAt: new Date().toISOString(),
      source,
    },
  }
}

type DetectedCapabilityOverrides = Partial<{
  text: boolean
  image: boolean
  pdf: boolean
  attachment: boolean
  tool_call: boolean
  reasoning: boolean
  native_web: boolean
  temperature: boolean
}>

type DetectedVariantOverrides = {
  variantGroup?: "standard" | "extended" | "deepseek" | "custom"
  variantOptions?: string[]
  variants?: Record<string, Record<string, any>>
}

type ProbeResult = {
  detected?: boolean
  warnings: string[]
}

type VariantProbeResult = {
  detected: DetectedVariantOverrides
  warnings: string[]
}

type ProbeLanguageModel = Parameters<typeof generateText>[0]["model"]

const ONE_BY_ONE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p2t6iUAAAAASUVORK5CYII="

const MINIMAL_PDF =
  "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iago0IDAgb2JqCjw8L0xlbmd0aCA0ND4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgMTIwIFRkIChvaikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA1MyAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAxNjggMDAwMDAgbiAKMDAwMDAwMDI2MiAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjMyOQolJUVPRgo="

function buildDetectedModelPatchWithOverrides(
  model: Provider.Model,
  overrides: DetectedCapabilityOverrides,
  variantOverrides?: DetectedVariantOverrides,
) {
  const interleaved =
    model.capabilities.interleaved === true || typeof model.capabilities.interleaved === "object"
      ? model.capabilities.interleaved
      : undefined
  const input = {
    ...model.capabilities.input,
    text: overrides.text ?? model.capabilities.input.text ?? true,
    image: overrides.image ?? model.capabilities.input.image ?? false,
    pdf: overrides.pdf ?? model.capabilities.input.pdf ?? false,
  }
  const variants = variantOverrides?.variants ?? model.variants
  const variantOptions = variantOverrides?.variantOptions
  const variantGroup = variantOverrides?.variantGroup
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    release_date: model.release_date,
    protocol: model.protocol,
    status: model.status === "active" ? undefined : model.status,
    interleaved,
    cachePromptTTL: model.cachePromptTTL,
    provider: {
      api: model.api.url || undefined,
      npm: model.api.npm || undefined,
    },
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cache_read: model.cost.cache.read,
      cache_write: model.cost.cache.write,
    },
    capabilities: {
      input,
      output: model.capabilities.output,
      text: input.text,
      image: input.image,
      audio: model.capabilities.input.audio ?? false,
      video: model.capabilities.input.video ?? false,
      pdf: input.pdf,
      attachment:
        overrides.attachment ??
        model.capabilities.attachment ??
        input.image ??
        model.capabilities.input.audio ??
        model.capabilities.input.video ??
        input.pdf,
      tool_call: overrides.tool_call ?? model.capabilities.toolcall,
      reasoning: overrides.reasoning ?? model.capabilities.reasoning,
      patch_editing: model.capabilities.patch_editing,
      native_web: overrides.native_web ?? model.capabilities.native_web,
      temperature: overrides.temperature ?? model.capabilities.temperature,
    },
    headers: model.headers,
    options: model.options,
    variants,
    variantGroup,
    variantOptions,
    request:
      variantOptions || variantGroup
        ? {
            variantGroup,
            variantOptions,
          }
        : undefined,
  }
}

export function buildDetectedModelPatch(
  model: Provider.Model,
  overrides: DetectedCapabilityOverrides = {},
  variantOverrides?: DetectedVariantOverrides,
) {
  return buildDetectedModelPatchWithOverrides(model, overrides, variantOverrides)
}

const probeToolSchema = z.object({})

const unsupportedTemperaturePatterns = [
  /temperature/i,
  /(unsupported|not support|not supported|invalid|unknown|cannot|does not allow|doesn't allow)/i,
]

const unsupportedToolCallPatterns = [
  /tool|function/i,
  /(unsupported|not support|not supported|invalid|unknown|cannot|does not allow|doesn't allow|not available)/i,
]

function probeWarnings(input?: readonly unknown[]) {
  return input?.map((item) => String(item)).filter((item) => item.length > 0) ?? []
}

function probeError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return `${scope}: ${message}`
}

function safeProbe(scope: string, effect: Effect.Effect<ProbeResult>) {
  return Effect.matchCause(effect, {
    onFailure: (cause) =>
      ({
        detected: undefined,
        warnings: [probeError(scope, Cause.squash(cause))],
      }) satisfies ProbeResult,
    onSuccess: (result) => result,
  })
}

function safeVariantProbe(scope: string, effect: Effect.Effect<VariantProbeResult>) {
  return Effect.matchCause(effect, {
    onFailure: (cause) =>
      ({
        detected: {},
        warnings: [probeError(scope, Cause.squash(cause))],
      }) satisfies VariantProbeResult,
    onSuccess: (result) => result,
  })
}

function matchesUnsupportedCapability(message: string, patterns: RegExp[]) {
  return patterns.every((pattern) => pattern.test(message))
}

function runTextProbe(language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          prompt: "Reply with ok.",
          maxOutputTokens: 4,
          temperature: 0,
          abortSignal: signal,
        }),
      )
      return {
        detected: true,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      return {
        warnings: [probeError("text", error)],
      } satisfies ProbeResult
    }
  })
}

function runTemperatureProbe(language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          prompt: "Reply with ok.",
          maxOutputTokens: 4,
          temperature: 0.7,
          abortSignal: signal,
        }),
      )
      return {
        detected: true,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (matchesUnsupportedCapability(message, unsupportedTemperaturePatterns)) {
        return {
          detected: false,
          warnings: [probeError("temperature", error)],
        } satisfies ProbeResult
      }
      return {
        warnings: [probeError("temperature", error)],
      } satisfies ProbeResult
    }
  })
}

function runToolCallProbe(language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    let called = false
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          prompt: "Call the probe tool exactly once, then stop.",
          maxOutputTokens: 16,
          temperature: 0,
          abortSignal: signal,
          tools: {
            probe: tool({
              description: "Capability probe tool. Call exactly once.",
              inputSchema: probeToolSchema,
              execute: async () => {
                called = true
                return "ok"
              },
            }),
          },
          toolChoice: "required",
        }),
      )
      return {
        detected: called || result.toolCalls.length > 0,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (matchesUnsupportedCapability(message, unsupportedToolCallPatterns)) {
        return {
          detected: false,
          warnings: [probeError("tool_call", error)],
        } satisfies ProbeResult
      }
      return {
        warnings: [probeError("tool_call", error)],
      } satisfies ProbeResult
    }
  })
}

function runImageProbe(language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Reply with ok." },
                { type: "image", image: ONE_BY_ONE_PNG },
              ],
            },
          ],
          maxOutputTokens: 4,
          temperature: 0,
          abortSignal: signal,
        }),
      )
      return {
        detected: true,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      return {
        warnings: [probeError("image", error)],
      } satisfies ProbeResult
    }
  })
}

function runPdfProbe(language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Reply with ok." },
                {
                  type: "file",
                  data: MINIMAL_PDF,
                  mediaType: "application/pdf",
                  filename: "probe.pdf",
                },
              ],
            },
          ],
          maxOutputTokens: 4,
          temperature: 0,
          abortSignal: signal,
        }),
      )
      return {
        detected: true,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      return {
        warnings: [probeError("pdf", error)],
      } satisfies ProbeResult
    }
  })
}

function runReasoningProbe(language: ProbeLanguageModel, signal: AbortSignal, advertisedReasoning: boolean) {
  return Effect.gen(function* () {
    try {
      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          prompt: "Think step by step internally, then reply with exactly ok.",
          maxOutputTokens: 8,
          temperature: 0,
          abortSignal: signal,
        }),
      )
      const warnings = probeWarnings(result.warnings)
      const reasoningTokens = result.usage?.outputTokenDetails?.reasoningTokens ?? result.usage?.reasoningTokens ?? 0
      if (reasoningTokens > 0) {
        return {
          detected: true,
          warnings,
        } satisfies ProbeResult
      }
      return {
        detected: false,
        warnings: advertisedReasoning ? [...warnings, "reasoning: no reasoning tokens observed"] : warnings,
      } satisfies ProbeResult
    } catch (error) {
      return {
        warnings: [probeError("reasoning", error)],
      } satisfies ProbeResult
    }
  })
}

function runNativeWebProbe(model: Provider.Model, language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    const npm = model.api.npm
    if (!npm) {
      return {
        warnings: [],
      } satisfies ProbeResult
    }

    try {
      const webTool = yield* Effect.promise(async () => {
        if (npm === "@ai-sdk/xai") {
          const mod = await import("@ai-sdk/xai")
          return mod.webSearch()
        }

        if (npm === "@ai-sdk/openai") {
          const mod = await import("@ai-sdk/openai/internal")
          return mod.webSearchPreview({
            searchContextSize: "low",
          })
        }

        if (npm === "@ai-sdk/anthropic") {
          const mod = await import("@ai-sdk/anthropic/internal")
          return mod.anthropicTools.webSearch_20260209({
            maxUses: 1,
          })
        }

        return undefined
      })

      if (!webTool) {
        return {
          warnings: [],
        } satisfies ProbeResult
      }

      const result = yield* Effect.promise(() =>
        generateText({
          model: language,
          prompt:
            "Use the web search tool exactly once to search for today's weather in Beijing, then reply with exactly ok.",
          maxOutputTokens: 16,
          temperature: 0,
          abortSignal: signal,
          tools: {
            native_web: webTool,
          },
          toolChoice: "required",
        }),
      )
      const sources = Array.isArray(result.sources) ? result.sources : []
      return {
        detected: result.toolCalls.length > 0 || sources.length > 0,
        warnings: probeWarnings(result.warnings),
      } satisfies ProbeResult
    } catch (error) {
      return {
        warnings: [probeError("native_web", error)],
      } satisfies ProbeResult
    }
  })
}

function runVariantProbe(model: Provider.Model, language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    const candidateVariants = ProviderTransform.variants(model, {
      ignoreReasoningCapability: true,
    })
    const keys = Object.keys(candidateVariants)
    if (keys.length === 0) {
      return {
        detected: {},
        warnings: [],
      } satisfies VariantProbeResult
    }

    const supported = yield* Effect.forEach(
      keys,
      (variantID) =>
        Effect.gen(function* () {
          try {
            const providerOptions = ProviderTransform.providerOptions(model, {
              ...ProviderTransform.options({
                model,
                sessionID: `detect-${model.providerID}-${model.id}`,
                providerOptions: {},
              }),
              ...(candidateVariants[variantID] ?? {}),
            })
            const result = yield* Effect.promise(() =>
              generateText({
                model: language,
                prompt: "Reply with ok.",
                maxOutputTokens: 4,
                temperature: 0,
                abortSignal: signal,
                providerOptions,
              }),
            )
            return {
              variantID,
              ok: true,
              warnings: probeWarnings(result.warnings),
            }
          } catch (error) {
            return {
              variantID,
              ok: false,
              warnings: [probeError(`variant:${variantID}`, error)],
            }
          }
        }),
      { concurrency: 1 },
    )

    const variantOptions = supported.filter((item) => item.ok).map((item) => item.variantID)
    if (variantOptions.length === 0) {
      return {
        detected: {
          variantGroup: "custom",
          variantOptions: [],
          variants: {},
        },
        warnings: supported.flatMap((item) => item.warnings),
      } satisfies VariantProbeResult
    }

    return {
      detected: {
        variantGroup: "custom",
        variantOptions,
        variants: Object.fromEntries(
          variantOptions.map((variantID) => [variantID, candidateVariants[variantID] ?? {}]),
        ),
      },
      warnings: supported.flatMap((item) => item.warnings),
    } satisfies VariantProbeResult
  })
}

function hasDetectedVariants(input: DetectedVariantOverrides) {
  return (input.variantOptions?.filter(Boolean).length ?? 0) > 0
}

function detectModelCapabilities(model: Provider.Model, language: ProbeLanguageModel, signal: AbortSignal) {
  return Effect.gen(function* () {
    const text = yield* safeProbe("text", runTextProbe(language, signal))
    const image = yield* safeProbe("image", runImageProbe(language, signal))
    const pdf = yield* safeProbe("pdf", runPdfProbe(language, signal))
    const toolCall = yield* safeProbe("tool_call", runToolCallProbe(language, signal))
    const reasoning = yield* safeProbe("reasoning", runReasoningProbe(language, signal, model.capabilities.reasoning))
    const nativeWeb = yield* safeProbe("native_web", runNativeWebProbe(model, language, signal))
    const temperature = yield* safeProbe("temperature", runTemperatureProbe(language, signal))
    const variants = yield* safeVariantProbe("variants", runVariantProbe(model, language, signal))
    const detectedReasoning =
      reasoning.detected === true || hasDetectedVariants(variants.detected) ? true : reasoning.detected
    return {
      detected: {
        text: text.detected,
        image: image.detected,
        pdf: pdf.detected,
        attachment:
          image.detected === true || pdf.detected === true
            ? true
            : image.detected === false && pdf.detected === false
              ? false
              : undefined,
        tool_call: toolCall.detected,
        reasoning: detectedReasoning,
        native_web: nativeWeb.detected,
        temperature: temperature.detected,
      } satisfies DetectedCapabilityOverrides,
      variants: variants.detected,
      warnings: [
        ...text.warnings,
        ...image.warnings,
        ...pdf.warnings,
        ...toolCall.warnings,
        ...reasoning.warnings,
        ...nativeWeb.warnings,
        ...temperature.warnings,
        ...variants.warnings,
      ],
    }
  })
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ListResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.list", c, function* () {
          const svc = yield* Provider.Service
          const cfg = yield* Config.Service
          const config = yield* cfg.get()
          const all = yield* Effect.promise(() => ModelsDev.get())
          const disabled = new Set(config.disabled_providers ?? [])
          const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
          const filtered: Record<string, (typeof all)[string]> = {}
          for (const [key, value] of Object.entries(all)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          const connected = Object.fromEntries(
            Object.entries(yield* svc.list()).filter(
              ([providerID]) => (enabled ? enabled.has(providerID) : true) && !disabled.has(providerID),
            ),
          )
          const providers = Object.assign(
            mapValues(filtered, (x) => Provider.fromModelsDevProvider(x)),
            connected,
          )
          return {
            all: Object.values(providers),
            default: Provider.defaultModelIDs(providers),
            connected: Object.keys(connected),
          }
        }),
    )
    .post(
      "/models/discover",
      describeRoute({
        summary: "Discover models for a configured provider",
        description: "Fetch a provider model list without exposing stored credentials.",
        operationId: "provider.models.discover",
        responses: {
          200: {
            description: "Provider model discovery result",
            content: { "application/json": { schema: resolver(ProviderModelDiscoveryResult) } },
          },
          ...errors(404),
        },
      }),
      validator("json", ProviderModelDiscoveryInput),
      async (c) =>
        jsonRequest("ProviderRoutes.models.discover", c, function* () {
          const input = c.req.valid("json")
          const svc = yield* Provider.Service
          const provider = yield* svc.getProvider(ProviderID.make(input.providerID))
          if (!provider) throw new NotFoundError({ message: `Provider not found: ${input.providerID}` })
          const safeProvider = canUseStoredA6ApiKey() ? provider : { ...provider, key: undefined }
          return yield* Effect.promise(() => discoverProviderModels(safeProvider, { signal: c.req.raw.signal }))
        }),
    )
    .post(
      "/models/match",
      describeRoute({
        summary: "Match model names from the local catalog",
        description: "Search the bundled Models.dev catalog without returning the complete catalog.",
        operationId: "provider.models.match",
        responses: {
          200: {
            description: "Matching model candidates",
            content: { "application/json": { schema: resolver(ProviderModelMatchResult) } },
          },
        },
      }),
      validator("json", ProviderModelMatchInput),
      async (c) =>
        jsonRequest("ProviderRoutes.models.match", c, function* () {
          const input = c.req.valid("json")
          const catalog = yield* Effect.promise(() => ModelsDev.get())
          return { models: matchModelsInCatalog({ providerID: input.providerID, query: input.query, catalog }) }
        }),
    )
    .post(
      "/models/suggest",
      describeRoute({
        summary: "Suggest model capabilities",
        description:
          "Suggest model capabilities from the local models.dev catalog and query the online catalog when the local data does not contain the model.",
        operationId: "provider.models.suggest",
        responses: {
          200: {
            description: "Model capability suggestion",
            content: { "application/json": { schema: resolver(ModelSuggestionResult) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          providerID: z.string().min(1),
          modelID: z.string().min(1),
          displayName: z.string().optional(),
          providerName: z.string().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("ProviderRoutes.models.suggest", c, function* () {
          const input = c.req.valid("json")
          const catalog = yield* Effect.promise(() => ModelsDev.get())
          return yield* Effect.promise(() =>
            suggestModelWithOnlineFallback({ ...input, catalog }, async () => {
              return ModelsDev.refresh(true)
            }, { preferOnline: true }),
          )
        }),
    )
    .get(
      "/lfapi/models/discover",
      describeRoute({
        summary: "Discover LFAPI models",
        description:
          "Read the LFAPI model catalog using the saved LFAPI credential. The response includes model IDs only and never includes credentials.",
        operationId: "provider.lfapi.models.list",
        responses: {
          200: {
            description: "LFAPI model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(LfApiDiscoverResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.lfapi.models.list", c, function* () {
          return yield* discoverLfApiModels({}, c.req.raw.signal)
        }),
    )
    .post(
      "/lfapi/models/discover",
      describeRoute({
        summary: "Discover LFAPI models with an optional temporary key",
        description:
          "Read the LFAPI model catalog using a temporary key from this request, or the saved LFAPI credential when omitted. The key is neither stored nor returned.",
        operationId: "provider.lfapi.models.discover",
        responses: {
          200: {
            description: "LFAPI model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(LfApiDiscoverResult) } },
          },
        },
      }),
      validator("json", LfApiDiscoverInput),
      async (c) =>
        jsonRequest("ProviderRoutes.lfapi.models.discover", c, function* () {
          return yield* discoverLfApiModels(c.req.valid("json"), c.req.raw.signal)
        }),
    )
    .get(
      "/a6api/models/discover",
      describeRoute({
        summary: "Discover A6API models",
        description:
          "Read the A6API model catalog using the saved A6API credential. The response includes only supported model IDs and never includes credentials.",
        operationId: "provider.a6api.models.list",
        responses: {
          200: {
            description: "Filtered A6API model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(A6ApiDiscoverResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.a6api.models.list", c, function* () {
          return yield* discoverA6ApiModels({}, c.req.raw.signal)
        }),
    )
    .post(
      "/a6api/models/discover",
      describeRoute({
        summary: "Discover A6API models with an optional temporary key",
        description:
          "Read the A6API model catalog using a temporary key from this request, or the saved A6API credential when omitted. The key is neither stored nor returned.",
        operationId: "provider.a6api.models.discover",
        responses: {
          200: {
            description: "Filtered A6API model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(A6ApiDiscoverResult) } },
          },
        },
      }),
      validator("json", A6ApiDiscoverInput),
      async (c) =>
        jsonRequest("ProviderRoutes.a6api.models.discover", c, function* () {
          return yield* discoverA6ApiModels(c.req.valid("json"), c.req.raw.signal)
        }),
    )
    .get(
      "/opencode/models/discover",
      describeRoute({
        summary: "Discover OpenCode Zen models",
        description: "Read the live OpenCode Zen model catalog using the saved credential when available.",
        operationId: "provider.opencode.models.list",
        responses: {
          200: {
            description: "OpenCode Zen model catalog",
            content: { "application/json": { schema: resolver(OpenCodeDiscoverResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.opencode.models.list", c, function* () {
          return yield* discoverOpenCodeModels({}, c.req.raw.signal)
        }),
    )
    .post(
      "/opencode/models/discover",
      describeRoute({
        summary: "Discover OpenCode Zen models with an optional temporary key",
        operationId: "provider.opencode.models.discover",
        responses: {
          200: {
            description: "OpenCode Zen model catalog",
            content: { "application/json": { schema: resolver(OpenCodeDiscoverResult) } },
          },
        },
      }),
      validator("json", OpenCodeDiscoverInput),
      async (c) =>
        jsonRequest("ProviderRoutes.opencode.models.discover", c, function* () {
          return yield* discoverOpenCodeModels(c.req.valid("json"), c.req.raw.signal)
        }),
    )
    .get(
      "/opencode/usage",
      describeRoute({
        summary: "Get OpenCode Zen quota usage",
        description: "Read the documented OpenCode Zen usage endpoint when available; no credentials are returned.",
        operationId: "provider.opencode.usage",
        responses: {
          200: {
            description: "OpenCode Zen quota usage",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.opencode.usage", c, function* () {
          return yield* queryOpenCodeUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/opencode-go/models/discover",
      describeRoute({
        summary: "Discover OpenCode Go models",
        description:
          "Read the OpenCode Go model catalog using the saved OpenCode Go credential. The response includes only supported model IDs and never includes credentials.",
        operationId: "provider.opencodeGo.models.list",
        responses: {
          200: {
            description: "OpenCode Go model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(OpenCodeGoDiscoverResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.opencodeGo.models.list", c, function* () {
          return yield* discoverOpenCodeGoModels({}, c.req.raw.signal)
        }),
    )
    .post(
      "/opencode-go/models/discover",
      describeRoute({
        summary: "Discover OpenCode Go models with an optional temporary key",
        description:
          "Read the OpenCode Go model catalog using a temporary key from this request, or the saved OpenCode Go credential when omitted. The key is neither stored nor returned.",
        operationId: "provider.opencodeGo.models.discover",
        responses: {
          200: {
            description: "OpenCode Go model catalog or a safe discovery error category",
            content: { "application/json": { schema: resolver(OpenCodeGoDiscoverResult) } },
          },
        },
      }),
      validator("json", OpenCodeGoDiscoverInput),
      async (c) =>
        jsonRequest("ProviderRoutes.opencodeGo.models.discover", c, function* () {
          return yield* discoverOpenCodeGoModels(c.req.valid("json"), c.req.raw.signal)
        }),
    )
    .get(
      "/opencode-go/usage",
      describeRoute({
        summary: "Get OpenCode Go quota usage",
        description:
          "Read OpenCode Go quota usage using the saved credential. The response never includes credentials and uses safe error categories when a quota cannot be read.",
        operationId: "provider.opencodeGo.usage",
        responses: {
          200: {
            description: "OpenCode Go quota usage or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.opencodeGo.usage", c, function* () {
          return yield* queryOpenCodeGoUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/minimax/usage",
      describeRoute({
        summary: "Get MiniMax Token Plan quota usage",
        description:
          "Read MiniMax Token Plan quota usage using the saved provider credential. The response never includes credentials and returns every model window reported by the provider, including five-hour and optional weekly windows, absolute count/token values when available, and relative reset durations when the provider omits absolute timestamps. MiniMax usage_count fields are exposed as remaining counts and used values are derived from total minus remaining.",
        operationId: "provider.minimax.usage",
        responses: {
          200: {
            description: "MiniMax quota usage or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.minimax.usage", c, function* () {
          return yield* queryMiniMaxUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/deepseek/usage",
      describeRoute({
        summary: "Get DeepSeek account balance",
        description: "Read DeepSeek account balance using the saved API key. Credentials are never returned.",
        operationId: "provider.deepseek.usage",
        responses: {
          200: {
            description: "DeepSeek balance or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.deepseek.usage", c, function* () {
          return yield* queryDeepSeekUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/moonshot/usage",
      describeRoute({
        summary: "Get Moonshot account balance",
        description:
          "Read Kimi/Moonshot account balance using the saved API key and the configured Moonshot regional endpoint. Credentials are never returned.",
        operationId: "provider.moonshot.usage",
        responses: {
          200: {
            description: "Moonshot balance or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.moonshot.usage", c, function* () {
          return yield* queryMoonshotUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/siliconflow/usage",
      describeRoute({
        summary: "Get SiliconFlow account balance",
        description: "Read SiliconFlow account balance using the saved API key. Credentials are never returned.",
        operationId: "provider.siliconflow.usage",
        responses: {
          200: {
            description: "SiliconFlow balance or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.siliconflow.usage", c, function* () {
          return yield* querySiliconFlowUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/openrouter/usage",
      describeRoute({
        summary: "Get OpenRouter key usage",
        description:
          "Read the OpenRouter key quota endpoint using the saved API key. This does not call Management-Key-only account credit endpoints.",
        operationId: "provider.openrouter.usage",
        responses: {
          200: {
            description: "OpenRouter key usage or a safe error category",
            content: { "application/json": { schema: resolver(QuotaUsageResult) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.openrouter.usage", c, function* () {
          return yield* queryOpenRouterUsage(c.req.raw.signal)
        }),
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Methods.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.auth", c, function* () {
          const svc = yield* ProviderAuth.Service
          return yield* svc.methods()
        }),
    )
    .post(
      "/:providerID/models/:modelID/detect",
      describeRoute({
        summary: "Detect model capabilities",
        description: "Run a minimal live probe against a provider model and persist the detected model override.",
        operationId: "provider.model.detect",
        responses: {
          200: {
            description: "Detected model capabilities",
            content: {
              "application/json": {
                schema: resolver(DetectResult),
              },
            },
          },
          ...errors(400),
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
          modelID: z.string().meta({ description: "Model ID" }),
        }),
      ),
      async (c) =>
        jsonRequest("ProviderRoutes.model.detect", c, function* () {
          const providerID = c.req.valid("param").providerID
          const modelID = ModelID.make(c.req.valid("param").modelID)
          const gate = decideCapabilityOperation({
            caller: "route:provider.model.detect",
            capability: "provider_manage",
            risk: "modify",
            source: "core",
            operation: "update",
            previewed: true,
            reversible: true,
            target: `${providerID}/${modelID}`,
            reason: "Run and save a model capability probe",
          })
          requireCapabilityDecision(gate.decision)
          const providerSvc = yield* Provider.Service
          const cfg = yield* Config.Service
          const model = yield* providerSvc.getModel(providerID, modelID)
          const language = yield* providerSvc.getLanguage(model)
          const capabilityProbe = yield* detectModelCapabilities(model, language, c.req.raw.signal)
          const detected = buildDetectedModelPatch(model, capabilityProbe.detected, capabilityProbe.variants)
          yield* cfg.updateGlobal({
            provider: {
              [providerID]: {
                models: {
                  [modelID]: detected,
                },
              },
            },
          })
          completeCapabilityOperation(gate.auditID, "completed")
          return {
            detected,
            saved: true,
            warnings: capabilityProbe.warnings,
          }
        }),
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.AuthorizeInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.authorize", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, inputs } = c.req.valid("json")
          const gate = decideCapabilityOperation({
            caller: "route:provider.oauth.authorize",
            capability: "provider_manage",
            risk: "credential",
            source: "core",
            operation: "update",
            previewed: true,
            reversible: true,
            target: String(providerID),
            reason: "Start provider OAuth credential flow",
          })
          requireCapabilityDecision(gate.decision)
          const svc = yield* ProviderAuth.Service
          const result = yield* svc.authorize({
            providerID,
            method,
            inputs,
          })
          completeCapabilityOperation(gate.auditID, "completed")
          return result
        }),
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.CallbackInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.callback", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, code } = c.req.valid("json")
          const gate = decideCapabilityOperation({
            caller: "route:provider.oauth.callback",
            capability: "provider_manage",
            risk: "credential",
            source: "core",
            operation: "update",
            previewed: true,
            reversible: true,
            target: String(providerID),
            reason: "Complete provider OAuth credential flow",
          })
          requireCapabilityDecision(gate.decision)
          const svc = yield* ProviderAuth.Service
          yield* svc.callback({
            providerID,
            method,
            code,
          })
          completeCapabilityOperation(gate.auditID, "completed")
          return true
        }),
    ),
)
