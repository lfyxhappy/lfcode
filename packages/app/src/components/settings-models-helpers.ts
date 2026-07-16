export type SubagentField = "general" | "explore" | "title" | "summary" | "compaction"

export const SUBAGENT_FIELDS: SubagentField[] = ["general", "explore", "title", "summary", "compaction"]
export const MODEL_CAPABILITY_KEYS = [
  "text",
  "image",
  "audio",
  "video",
  "pdf",
  "attachment",
  "tool_call",
  "reasoning",
  "patch_editing",
  "native_web",
  "temperature",
] as const

export type ModelDetectState = "idle" | "running" | "success" | "error"

export type ModelDetectResult = {
  detected?: {
    capabilities?:
      | {
          input?:
            | Partial<Record<"text" | "image" | "audio" | "video" | "pdf", boolean>>
            | Array<"text" | "image" | "audio" | "video" | "pdf">
          text?: boolean
          image?: boolean
          audio?: boolean
          video?: boolean
          pdf?: boolean
          attachment?: boolean
          tool_call?: boolean
          reasoning?: boolean
          patch_editing?: boolean
          native_web?: boolean
          temperature?: boolean
        }
      | null
    request?: {
      variantGroup?: "standard" | "extended" | "deepseek" | "custom" | null
      variantOptions?: string[] | null
    } | null
    variantGroup?: "standard" | "extended" | "deepseek" | "custom" | null
    variantOptions?: string[] | null
  } | null
  saved?: boolean
  warnings?: string[] | null
}

export type ModelRuntimePatch = {
  id?: string | null
  name?: string | null
  family?: string | null
  release_date?: string | null
  protocol?: "openai-chat" | "openai-responses" | "anthropic-messages" | "gemini" | null
  status?: "alpha" | "beta" | "deprecated" | null
  interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" } | null
  cachePromptTTL?: "5m" | "1h" | null
  provider?: {
    api?: string | null
    npm?: string | null
  } | null
  limit?: {
    context?: number | null
    input?: number | null
    output?: number | null
  } | null
  cost?: {
    input?: number | null
    output?: number | null
    cache_read?: number | null
    cache_write?: number | null
  } | null
  request?: {
    variant?: string | null
    variantGroup?: "standard" | "extended" | "deepseek" | "custom" | null
    variantOptions?: string[] | null
  } | null
  headers?: Record<string, string> | null
  options?: Record<string, unknown> | null
}

export function subagentModelValue(
  config: {
    agent?: Partial<Record<SubagentField, { model?: string | null } | undefined>>
  },
  field: SubagentField,
) {
  return config.agent?.[field]?.model ?? ""
}

export function subagentModelPatch(field: SubagentField, model: string) {
  return {
    agent: {
      [field]: {
        model: model || null,
      },
    },
  }
}

export function buildModelOverridePatch(model: ModelRuntimePatch) {
  return {
    id: model.id ?? undefined,
    name: model.name ?? undefined,
    family: model.family ?? undefined,
    release_date: model.release_date ?? undefined,
    protocol: model.protocol ?? undefined,
    status: model.status ?? undefined,
    interleaved: model.interleaved ?? undefined,
    cachePromptTTL: model.cachePromptTTL ?? undefined,
    provider: model.provider ?? undefined,
    limit: model.limit ?? undefined,
    cost: model.cost ?? undefined,
    request: model.request ?? undefined,
    headers: model.headers ?? undefined,
    options: model.options ?? undefined,
  }
}

export function readDetectedCapabilities(result: ModelDetectResult) {
  const input = result.detected?.capabilities?.input
  const inputMap = Array.isArray(input) ? Object.fromEntries(input.map((item) => [item, true])) : input
  const capabilities = result.detected?.capabilities
  return {
    text: inputMap?.text ?? capabilities?.text ?? true,
    image: inputMap?.image ?? capabilities?.image ?? false,
    audio: inputMap?.audio ?? capabilities?.audio ?? false,
    video: inputMap?.video ?? capabilities?.video ?? false,
    pdf: inputMap?.pdf ?? capabilities?.pdf ?? false,
    attachment: capabilities?.attachment ?? false,
    tool_call: capabilities?.tool_call ?? false,
    reasoning: capabilities?.reasoning ?? false,
    patch_editing: capabilities?.patch_editing ?? false,
    native_web: capabilities?.native_web ?? false,
    temperature: capabilities?.temperature ?? false,
  } satisfies Record<(typeof MODEL_CAPABILITY_KEYS)[number], boolean>
}

export function readDetectedVariants(result: ModelDetectResult) {
  return {
    variantGroup: result.detected?.request?.variantGroup ?? result.detected?.variantGroup ?? undefined,
    variantOptions: (result.detected?.request?.variantOptions ?? result.detected?.variantOptions)?.filter(Boolean) ?? [],
  }
}
