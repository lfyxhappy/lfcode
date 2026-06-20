import {
  inferModelCapabilities,
  normalizeModelCapabilities,
  protocolPackage,
  ProviderProtocol,
  type ModelCapabilityConfig,
} from "@lfcode-ai/shared/model-capabilities"
import {
  VOLCENGINE_CODING_PLAN_BASE_URL,
  VOLCENGINE_CODING_PLAN_MODELS,
  VOLCENGINE_CODING_PLAN_NAME,
  VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT,
  VOLCENGINE_CODING_PLAN_PRESET_ID,
  VOLCENGINE_CODING_PLAN_PROVIDER_ID,
} from "@lfcode-ai/shared/volcengine-coding-plan"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

export const PROTOCOLS = [
  ProviderProtocol.OpenAIChat,
  ProviderProtocol.OpenAIResponses,
  ProviderProtocol.AnthropicMessages,
  ProviderProtocol.Gemini,
] as const
export type Protocol = (typeof PROTOCOLS)[number]

export const CAPABILITY_KEYS = [
  "text",
  "image",
  "audio",
  "video",
  "pdf",
  "tool_call",
  "reasoning",
  "native_web",
  "temperature",
] as const
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
  limit?: {
    context: string
    output: string
  }
  capabilities: ModelCapabilities
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
  limit: {
    context: number
    output: number
  }
  capabilities: Partial<ModelCapabilities>
}

export const CUSTOM_PROVIDER_PRESETS = [
  {
    id: VOLCENGINE_CODING_PLAN_PRESET_ID,
    providerID: VOLCENGINE_CODING_PLAN_PROVIDER_ID,
    name: VOLCENGINE_CODING_PLAN_NAME,
    protocol: ProviderProtocol.OpenAIChat,
    baseURL: VOLCENGINE_CODING_PLAN_BASE_URL,
    models: VOLCENGINE_CODING_PLAN_MODELS.map((model) => volcengineModel(model.id, model.context, model.image)),
  },
] as const

export const CUSTOM_PROVIDER_PRESET_OPTIONS = [
  "custom",
] as CustomProviderPresetID[]

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
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
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
    return { id: idError, name: nameError, context: contextError, output: outputError }
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
          ...(context && output ? { limit: { context: Number(context), output: Number(output) } } : {}),
          capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, m.capabilities[key]])),
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
  tool_call: true,
  reasoning: false,
  native_web: false,
  temperature: true,
})

export const inferCapabilities = (input: {
  id: string
  name: string
  protocol?: Protocol
  current?: ModelCapabilities
  manual?: ModelCapabilityManual
}) => {
  const normalized = normalizeModelCapabilities({
    inferred: inferModelCapabilities({ modelID: input.id, apiID: input.name, protocol: input.protocol }),
    explicit: input.current && input.manual ? toManualConfig(input.current, input.manual) : undefined,
  })
  return {
    text: normalized.input.text,
    image: normalized.input.image,
    audio: normalized.input.audio,
    video: normalized.input.video,
    pdf: normalized.input.pdf,
    tool_call: normalized.tool_call,
    reasoning: normalized.reasoning,
    native_web: normalized.native_web,
    temperature: normalized.temperature,
  }
}

export const modelRow = (): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  limit: {
    context: "",
    output: "",
  },
  capabilities: defaultCapabilities(),
  manual: {},
  err: {},
})
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })

export function presetModelRow(input: CustomProviderPresetModel): ModelRow {
  return {
    row: nextRow(),
    id: input.id,
    name: input.name,
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
      tool_call: true,
      reasoning: false,
      native_web: false,
      temperature: true,
    },
  }
}

function positiveInt(input: string) {
  const value = Number(input)
  return Number.isInteger(value) && value > 0 && String(value) === input
}
