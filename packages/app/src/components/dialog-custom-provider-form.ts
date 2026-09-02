import {
  inferModelCapabilities,
  inferModelProfile,
  normalizeModelCapabilities,
  protocolPackage,
  ProviderProtocol,
  type ModelCapabilityConfig,
} from "@lfcode-ai/shared/model-capabilities"
import { MODEL_CAPABILITY_KEYS } from "./settings-models-helpers"
import {
  VOLCENGINE_CODING_PLAN_BASE_URL,
  VOLCENGINE_CODING_PLAN_MODELS,
  VOLCENGINE_CODING_PLAN_NAME,
  VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT,
  VOLCENGINE_CODING_PLAN_PRESET_ID,
  VOLCENGINE_CODING_PLAN_PROVIDER_ID,
} from "@lfcode-ai/shared/volcengine-coding-plan"
import {
  OPENCODE_GO_BASE_URL,
  OPENCODE_GO_NAME,
  OPENCODE_GO_PRESET_ID,
  OPENCODE_GO_PROVIDER_ID,
} from "@lfcode-ai/shared/opencode-go"
import {
  OPENCODE_BASE_URL,
  OPENCODE_NAME,
  OPENCODE_PRESET_ID,
  OPENCODE_PROVIDER_ID,
} from "@lfcode-ai/shared/opencode"
import {
  LFAPI_BASE_URL,
  LFAPI_NAME,
  LFAPI_PRESET_ID,
  LFAPI_PROVIDER_ID,
} from "@lfcode-ai/shared/lfapi"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

export const PROTOCOLS = [
  ProviderProtocol.OpenAIChat,
  ProviderProtocol.OpenAIResponses,
  ProviderProtocol.AnthropicMessages,
  ProviderProtocol.Gemini,
] as const
export type Protocol = (typeof PROTOCOLS)[number]

export const A6API_MODEL_PROTOCOLS = [
  ProviderProtocol.OpenAIChat,
  ProviderProtocol.OpenAIResponses,
  ProviderProtocol.AnthropicMessages,
] as const

export const A6API_PROVIDER_ID = "a6api"
export const A6API_BASE_URL = "https://a6api.com/v1"
export const LFAPI_MODEL_PROTOCOLS = [
  ProviderProtocol.OpenAIChat,
  ProviderProtocol.OpenAIResponses,
] as const
export { LFAPI_BASE_URL, LFAPI_NAME, LFAPI_PRESET_ID, LFAPI_PROVIDER_ID }
export { OPENCODE_GO_PROVIDER_ID }

export const CAPABILITY_KEYS = MODEL_CAPABILITY_KEYS
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number]

export type ModelCapabilities = Record<CapabilityKey, boolean>
export type ModelCapabilityManual = Partial<Record<CapabilityKey, true>>

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  context?: string
  output?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  protocol?: Protocol
  available?: boolean
  limit?: {
    context: string
    output: string
  }
  capabilities: ModelCapabilities
  reasoning_options?: Array<{ type: string; values?: string[]; min?: number; max?: number }>
  manual: ModelCapabilityManual
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  preset?: CustomProviderPresetID
  protocol: Protocol
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

export type CustomProviderPresetID = "custom" | (typeof CUSTOM_PROVIDER_PRESETS)[number]["id"]

type CustomProviderPresetModel = {
  id: string
  name: string
  protocol?: Protocol
  limit: {
    context: number
    output: number
  }
  capabilities: Partial<ModelCapabilities>
}

export const CUSTOM_PROVIDER_PRESETS = [
  {
    id: A6API_PROVIDER_ID,
    providerID: A6API_PROVIDER_ID,
    name: "A6API",
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: A6API_BASE_URL,
    models: [],
  },
  {
    id: LFAPI_PRESET_ID,
    providerID: LFAPI_PROVIDER_ID,
    name: LFAPI_NAME,
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: LFAPI_BASE_URL,
    models: [],
  },
  {
    id: VOLCENGINE_CODING_PLAN_PRESET_ID,
    providerID: VOLCENGINE_CODING_PLAN_PROVIDER_ID,
    name: VOLCENGINE_CODING_PLAN_NAME,
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: VOLCENGINE_CODING_PLAN_BASE_URL,
    models: VOLCENGINE_CODING_PLAN_MODELS.map((model) => volcengineModel(model.id, model.context, model.image)),
  },
  {
    id: OPENCODE_PRESET_ID,
    providerID: OPENCODE_PROVIDER_ID,
    name: OPENCODE_NAME,
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: OPENCODE_BASE_URL,
    models: [],
  },
  {
    id: OPENCODE_GO_PRESET_ID,
    providerID: OPENCODE_GO_PROVIDER_ID,
    name: OPENCODE_GO_NAME,
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: OPENCODE_GO_BASE_URL,
    models: [],
  },
] as const

export const CUSTOM_PROVIDER_PRESET_OPTIONS = [
  "custom",
] as CustomProviderPresetID[]

export function apiKeyForPresetChange(input: {
  current?: CustomProviderPresetID
  next: CustomProviderPresetID
  apiKey: string
}) {
  if ((input.current ?? "custom") === input.next) return input.apiKey
  return ""
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()
  const protocol = input.form.protocol
  const npm = protocolPackage(protocol)

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : providerID === A6API_PROVIDER_ID && baseURL !== A6API_BASE_URL
        ? input.t("provider.custom.a6api.error.baseURL")
        : providerID === LFAPI_PROVIDER_ID && baseURL !== LFAPI_BASE_URL
          ? input.t("provider.custom.lfapi.error.baseURL")
          : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : providerID === A6API_PROVIDER_ID && !isA6ApiModelID(id)
        ? input.t("provider.custom.a6api.error.unsupportedModel")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const protocolError =
      providerID === A6API_PROVIDER_ID && !isA6ApiProtocol(m.protocol ?? protocol)
        ? input.t("provider.custom.a6api.error.unsupportedProtocol")
        : providerID === LFAPI_PROVIDER_ID && !isLfApiProtocol(m.protocol ?? protocol)
          ? input.t("provider.custom.lfapi.error.unsupportedProtocol")
        : undefined
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    const context = m.limit?.context.trim() ?? ""
    const output = m.limit?.output.trim() ?? ""
    const contextError =
      !context && output
        ? input.t("provider.custom.error.required")
        : context && !positiveInt(context)
          ? input.t("provider.custom.error.positiveInteger")
          : undefined
    const outputError =
      !output && context
        ? input.t("provider.custom.error.required")
        : output && !positiveInt(output)
          ? input.t("provider.custom.error.positiveInteger")
          : undefined
    return { id: idError ?? protocolError, name: nameError, context: contextError, output: outputError }
  })
  const modelsValid = models.every((m) => !m.id && !m.name && !m.context && !m.output)
  const modelConfig = Object.fromEntries(
    input.form.models.map((m) => {
      const context = m.limit?.context.trim() ?? ""
      const output = m.limit?.output.trim() ?? ""
      return [
        m.id.trim(),
        {
          name: m.name.trim(),
          protocol: m.protocol ?? protocol,
          ...(context && output ? { limit: { context: Number(context), output: Number(output) } } : {}),
          capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, m.capabilities[key]])),
          ...(m.reasoning_options?.length ? { reasoning_options: m.reasoning_options } : {}),
        },
      ]
    }),
  )

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm,
        name,
        protocol,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const defaultCapabilities = (): ModelCapabilities => ({
  text: true,
  image: false,
  audio: false,
  video: false,
  pdf: false,
  attachment: false,
  tool_call: true,
  reasoning: false,
  patch_editing: false,
  native_web: false,
  temperature: true,
})

export const inferCapabilities = (input: {
  id: string
  name: string
  providerID?: string
  protocol?: Protocol
  explicit?: Partial<ModelCapabilities>
  current?: ModelCapabilities
  manual?: ModelCapabilityManual
}) => {
  const normalized = normalizeModelCapabilities({
    inferred: inferModelCapabilities({ modelID: input.id, apiID: input.name }),
    explicit: input.current && input.manual ? toManualConfig(input.current, input.manual) : undefined,
  })
  return {
    text: normalized.input.text,
    image: normalized.input.image,
    audio: normalized.input.audio,
    video: normalized.input.video,
    pdf: normalized.input.pdf,
    attachment: normalized.attachment,
    tool_call: normalized.tool_call,
    reasoning: normalized.reasoning,
    patch_editing: normalized.patch_editing,
    native_web: normalized.native_web,
    temperature: normalized.temperature,
    ...input.explicit,
  }
}

export type A6ApiDiscoveredModel = {
  id: string
  name: string
  protocol: (typeof A6API_MODEL_PROTOCOLS)[number]
  capabilities?: Partial<ModelCapabilities>
  reasoning_options?: Array<{ type: string; values?: string[]; min?: number; max?: number }>
  limit?: { context: number; input?: number; output: number }
  modalities?: { input: string[]; output: string[] }
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  source_updated_at?: string
}

export function isA6ApiModelID(input: string) {
  const modelID = input.trim().toLowerCase()
  return (
    modelID.startsWith("gpt-5.6") ||
    modelID.startsWith("grok-4.6") ||
    modelID.startsWith("claude-5") ||
    modelID.startsWith("deepseek")
  )
}

export function isA6ApiProtocol(input: Protocol): input is (typeof A6API_MODEL_PROTOCOLS)[number] {
  return A6API_MODEL_PROTOCOLS.some((protocol) => protocol === input)
}

export function isLfApiProtocol(input: Protocol): input is (typeof LFAPI_MODEL_PROTOCOLS)[number] {
  return LFAPI_MODEL_PROTOCOLS.some((protocol) => protocol === input)
}

export function mergeA6ApiModelRows(input: {
  current: readonly ModelRow[]
  discovered: readonly A6ApiDiscoveredModel[]
  providerID?: string
}): ModelRow[] {
  const discovered = new Map(input.discovered.map((model) => [model.id, model]))
  const current = input.current.map((model) => {
    const candidate = discovered.get(model.id)
    if (!candidate) return { ...model, available: false }

    // The discovery response is the source of truth for the wire format of a
    // model. A stale row can contain the provider's old default protocol, but
    // that must not override a model-level protocol returned by the catalog.
    const protocol = candidate.protocol
    const profile = inferModelProfile({ modelID: model.id, apiID: model.name })
    const discoveredCapabilities = candidate.modalities
      ? {
          ...candidate.capabilities,
          text: candidate.modalities.input.includes("text"),
          image: candidate.modalities.input.includes("image"),
          audio: candidate.modalities.input.includes("audio"),
          video: candidate.modalities.input.includes("video"),
          pdf: candidate.modalities.input.includes("pdf"),
          attachment: candidate.modalities.input.some((item) => item !== "text"),
        }
      : candidate.capabilities
    const capabilities = inferCapabilities({
      id: model.id,
      name: model.name,
      providerID: input.providerID,
      protocol,
      explicit: discoveredCapabilities,
      current: model.capabilities,
      manual: model.manual,
    })
    return {
      ...model,
      protocol,
      available: true,
      limit: {
        context: model.limit?.context || String(profile.limit.context),
        output: model.limit?.output || String(profile.limit.output),
      },
      capabilities: {
        ...model.capabilities,
        ...Object.fromEntries(CAPABILITY_KEYS.filter((key) => !model.manual[key]).map((key) => [key, capabilities[key]])),
      },
      reasoning_options: candidate.reasoning_options,
    }
  })
  const currentIDs = new Set(input.current.map((model) => model.id))
  return [
    ...current,
    ...input.discovered
      .filter((model) => !currentIDs.has(model.id))
      .map((model) => a6ApiModelRow(model, input.providerID)),
  ]
}

export const modelRow = (protocol: Protocol = ProviderProtocol.OpenAIChat): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  protocol,
  limit: {
    context: "",
    output: "",
  },
  capabilities: defaultCapabilities(),
  manual: {},
  err: {},
})
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })

function a6ApiModelRow(input: A6ApiDiscoveredModel, providerID?: string): ModelRow {
  const profile = inferModelProfile({ modelID: input.id, apiID: input.name })
  return {
    ...modelRow(input.protocol),
    id: input.id,
    name: input.name,
    available: true,
    limit: {
      context: String(input.limit?.context ?? profile.limit.context),
      output: String(input.limit?.output ?? profile.limit.output),
    },
    capabilities: inferCapabilities({
      id: input.id,
      name: input.name,
      providerID,
      protocol: input.protocol,
      explicit: input.capabilities,
    }),
    reasoning_options: input.reasoning_options,
  }
}

export function presetModelRow(input: CustomProviderPresetModel, protocol?: Protocol): ModelRow {
  return {
    row: nextRow(),
    id: input.id,
    name: input.name,
    protocol: input.protocol ?? protocol,
    limit: {
      context: String(input.limit.context),
      output: String(input.limit.output),
    },
    capabilities: {
      ...defaultCapabilities(),
      ...input.capabilities,
    },
    manual: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as ModelCapabilityManual,
    err: {},
  }
}

function toManualConfig(input: ModelCapabilities, manual: ModelCapabilityManual): ModelCapabilityConfig {
  return Object.fromEntries(CAPABILITY_KEYS.filter((key) => manual[key]).map((key) => [key, input[key]]))
}

function volcengineModel(id: string, context: number, image: boolean): CustomProviderPresetModel {
  return {
    id,
    name: id,
    limit: {
      context,
      output: VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT,
    },
    capabilities: {
      image,
      audio: false,
      video: false,
      pdf: false,
      attachment: image,
      tool_call: true,
      reasoning: false,
      patch_editing: false,
      native_web: false,
      temperature: true,
    },
  }
}

function positiveInt(input: string) {
  const value = Number(input)
  return Number.isInteger(value) && value > 0 && String(value) === input
}
