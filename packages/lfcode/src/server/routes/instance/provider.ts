import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { ConfigProvider } from "@/config/provider"
import { Provider } from "@/provider"
import { ModelsDev } from "@/provider"
import { ProviderAuth } from "@/provider"
import { ProviderTransform } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { mapValues } from "remeda"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Cause, Effect } from "effect"
import { jsonRequest } from "./trace"
import { generateText, tool } from "ai"

const DetectResult = z.object({
  detected: ConfigProvider.Model.zod,
  saved: z.boolean(),
  warnings: z.array(z.string()),
})

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
      const reasoningTokens =
        result.usage?.outputTokenDetails?.reasoningTokens ?? result.usage?.reasoningTokens ?? 0
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
          prompt: "Use the web search tool exactly once to search for today's weather in Beijing, then reply with exactly ok.",
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
    const detectedReasoning = reasoning.detected === true || hasDetectedVariants(variants.detected) ? true : reasoning.detected
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
          const connected = yield* svc.list()
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
          const svc = yield* ProviderAuth.Service
          return yield* svc.authorize({
            providerID,
            method,
            inputs,
          })
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
          const svc = yield* ProviderAuth.Service
          yield* svc.callback({
            providerID,
            method,
            code,
          })
          return true
        }),
    ),
)
