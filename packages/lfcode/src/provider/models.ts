import { Global } from "../global"
import { Log } from "../util"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util"
import { Flock } from "@lfcode-ai/shared/util/flock"
import { Hash } from "@lfcode-ai/shared/util/hash"
import {
  VOLCENGINE_CODING_PLAN_BASE_URL,
  VOLCENGINE_CODING_PLAN_ENV,
  VOLCENGINE_CODING_PLAN_MODELS,
  VOLCENGINE_CODING_PLAN_NAME,
  VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT,
  VOLCENGINE_CODING_PLAN_PROVIDER_ID,
} from "@lfcode-ai/shared/volcengine-coding-plan"
import {
  MINIMAX_API_ENV,
  MINIMAX_API_URL,
  MINIMAX_MODELS,
  MINIMAX_PROVIDER_ID,
  MINIMAX_PROVIDER_NAME,
  isMiniMaxResponsesModelID,
  resolveMiniMaxModelID,
} from "./minimax"
import {
  OPENCODE_GO_BASE_URL,
  OPENCODE_GO_CONTEXT_LIMIT,
  OPENCODE_GO_ENV,
  OPENCODE_GO_MODELS,
  OPENCODE_GO_NAME,
  OPENCODE_GO_OUTPUT_LIMIT,
  OPENCODE_GO_PROVIDER_ID,
} from "@lfcode-ai/shared/opencode-go"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

const log = Log.create({ service: "models.dev" })
const source = url()
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
)
const ttl = 5 * 60 * 1000
let lastForcedRefreshAt = 0
let refreshInFlight: Promise<Record<string, Provider> | undefined> | undefined

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
)

const Cost = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  context_over_200k: z
    .object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
    })
    .optional(),
})

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  // A provider can expose different models through different wire formats.
  // Keep the protocol on the model instead of inferring it from the provider.
  protocol: z.enum(["openai-chat", "openai-responses", "anthropic-messages", "gemini"]).optional(),
  family: z.string().optional(),
  release_date: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean(),
  tool_call: z.boolean(),
  interleaved: z
    .union([
      z.literal(true),
      z
        .object({
          field: z.enum(["reasoning_content", "reasoning_details"]),
        })
        .strict(),
    ])
    .optional(),
  cost: Cost.optional(),
  limit: z.object({
    context: z.number(),
    input: z.number().optional(),
    output: z.number(),
  }),
  modalities: z
    .object({
      input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
    })
    .optional(),
  reasoning_options: z
    .array(
      z
        .object({
          type: z.string(),
          values: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .optional(),
  experimental: z
    .object({
      modes: z
        .record(
          z.string(),
          z.object({
            cost: Cost.optional(),
            provider: z
              .object({
                body: z.record(z.string(), JsonValue).optional(),
                headers: z.record(z.string(), z.string()).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
  provider: z
    .object({
      npm: z.string().optional(),
      api: z.string().optional(),
      protocol: z.enum(["openai-chat", "openai-responses", "anthropic-messages", "gemini"]).optional(),
    })
    .optional(),
})
export type Model = z.infer<typeof Model>

export const Provider = z.object({
  api: z.string().optional(),
  name: z.string(),
  env: z.array(z.string()),
  id: z.string(),
  npm: z.string().optional(),
  models: z.record(z.string(), Model),
})

export type Provider = z.infer<typeof Provider>

export function builtin(): Record<string, Provider> {
  return {
    [MINIMAX_PROVIDER_ID]: {
      api: MINIMAX_API_URL,
      name: MINIMAX_PROVIDER_NAME,
      env: [...MINIMAX_API_ENV],
      id: MINIMAX_PROVIDER_ID,
      npm: "@ai-sdk/openai",
      models: Object.fromEntries(
        MINIMAX_MODELS.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.id,
            family: "minimax",
            release_date: model.id === "MiniMax-M3" ? "2026-06-01" : "2026-03-18",
            attachment: model.image || model.video,
            reasoning: true,
            reasoning_options: model.reasoningOptions ? [...model.reasoningOptions] : undefined,
            temperature: true,
            tool_call: true,
            limit: {
              context: model.context,
              output: model.output,
            },
            modalities: {
              input: ["text", ...(model.image ? ["image" as const] : []), ...(model.video ? ["video" as const] : [])],
              output: ["text" as const],
            },
            ...(("provider" in model && model.provider) ? { provider: model.provider } : {}),
          },
        ]),
      ),
    },
    [VOLCENGINE_CODING_PLAN_PROVIDER_ID]: {
      api: VOLCENGINE_CODING_PLAN_BASE_URL,
      name: VOLCENGINE_CODING_PLAN_NAME,
      env: VOLCENGINE_CODING_PLAN_ENV,
      id: VOLCENGINE_CODING_PLAN_PROVIDER_ID,
      npm: "@ai-sdk/openai-compatible",
      models: Object.fromEntries(
        VOLCENGINE_CODING_PLAN_MODELS.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.id,
            release_date: "",
            attachment: model.image,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: {
              context: model.context,
              output: VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT,
            },
            modalities: {
              input: model.image ? ["text", "image"] : ["text"],
              output: ["text"],
            },
          },
        ]),
      ),
    },
    [OPENCODE_GO_PROVIDER_ID]: {
      api: OPENCODE_GO_BASE_URL,
      name: OPENCODE_GO_NAME,
      env: OPENCODE_GO_ENV,
      id: OPENCODE_GO_PROVIDER_ID,
      npm: "@ai-sdk/openai-compatible",
      models: Object.fromEntries(
        OPENCODE_GO_MODELS.map((id) => {
          const profile = inferModelProfile({ modelID: id })
          return [
            id,
            {
            id,
            name: id,
            release_date: "",
            attachment: profile.capabilities.attachment,
            reasoning: profile.capabilities.reasoning,
            temperature: profile.capabilities.temperature,
            tool_call: profile.capabilities.tool_call,
            limit: {
              context: profile.limit.context ?? OPENCODE_GO_CONTEXT_LIMIT,
              output: profile.limit.output ?? OPENCODE_GO_OUTPUT_LIMIT,
            },
            modalities: profile.modalities,
            reasoning_options: profile.reasoningModes.length ? profile.reasoningModes : undefined,
            },
          ] as const
        }),
      ),
    },
  }
}

export { MINIMAX_API_URL, MINIMAX_PROVIDER_ID, isMiniMaxResponsesModelID, resolveMiniMaxModelID }

function url() {
  return Flag.LFCODE_MODELS_URL || "https://models.dev"
}

function fresh() {
  return Date.now() - Number(Filesystem.stat(filepath)?.mtimeMs ?? 0) < ttl
}

function skip(force: boolean) {
  return fresh() && (!force || Date.now() - lastForcedRefreshAt < ttl)
}

const fetchApi = async () => {
  const result = await fetch(`${url()}/api.json`, {
    headers: { "User-Agent": Installation.USER_AGENT },
    signal: AbortSignal.timeout(10000),
  })
  return { ok: result.ok, text: await result.text() }
}

function isCatalogShape(value: unknown): value is Record<string, Provider> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).some((provider) => {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) return false
    const models = (provider as { models?: unknown }).models
    return !!models && typeof models === "object" && !Array.isArray(models) && Object.keys(models).length > 0
  })
}

function isOnlineModelShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const model = value as { id?: unknown; name?: unknown; limit?: unknown }
  if (typeof model.id !== "string" || typeof model.name !== "string") return false
  if (!model.limit || typeof model.limit !== "object" || Array.isArray(model.limit)) return false
  const limit = model.limit as { context?: unknown; output?: unknown }
  return typeof limit.context === "number" && typeof limit.output === "number"
}

function isOnlineCatalog(value: unknown): value is Record<string, Provider> {
  if (!isCatalogShape(value)) return false
  const catalog = value as Record<string, Provider>
  if (!["openai", "anthropic", "google"].every((providerID) => isCatalogShape({ [providerID]: catalog[providerID] }))) {
    return false
  }
  return Object.values(catalog).every((provider) =>
    Object.values(provider.models).every((model) => isOnlineModelShape(model)),
  )
}

export function validateOnlineModelsCatalog(value: unknown): value is Record<string, Provider> {
  return isOnlineCatalog(value)
}

async function readCatalogFile(filepath: string) {
  const value = await Filesystem.readJson(filepath).catch(() => undefined)
  return isCatalogShape(value) ? value : undefined
}

export const Data = lazy(async () => {
  // The bundled snapshot remains the offline fallback, while a successful
  // refresh is persisted in the normal cache and must be visible to desktop
  // suggestion requests as well as CLI requests.
  const source = Flag.LFCODE_MODELS_PATH ?? filepath
  if (source) {
    const result = await readCatalogFile(source)
    if (result) return result
  }
  return (await import("./models-snapshot.js")).snapshot as Record<string, unknown>
})

export async function get(): Promise<Record<string, Provider>> {
  const result = await Data()
  return {
    ...(result as Record<string, Provider>),
    ...builtin(),
  }
}

export function refresh(force = false) {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    if (skip(force)) {
      Data.reset()
      return readCatalogFile(filepath)
    }
    let available: Record<string, Provider> | undefined
    await Flock.withLock(`models-dev:${filepath}`, async () => {
      if (skip(force)) {
        Data.reset()
        available = await readCatalogFile(filepath)
        return
      }
      const result = await fetchApi()
      if (!result.ok) return
      const parsed = JSON.parse(result.text) as unknown
      if (!isOnlineCatalog(parsed)) {
        log.warn("Ignoring invalid models.dev response")
        return
      }
      await Filesystem.write(filepath, result.text)
      available = parsed
      if (force) lastForcedRefreshAt = Date.now()
      Data.reset()
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    return available
  })().finally(() => {
    refreshInFlight = undefined
  })
  return refreshInFlight
}

if (!Flag.LFCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  void refresh()
  setInterval(
    async () => {
      await refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
