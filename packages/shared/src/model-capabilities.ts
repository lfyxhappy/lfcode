import { MODEL_NAME_CATALOG } from "./model-name-catalog"

export const ProviderProtocol = {
  OpenAIChat: "openai-chat",
  OpenAIResponses: "openai-responses",
  AnthropicMessages: "anthropic-messages",
  Gemini: "gemini",
} as const

export type ProviderProtocol = (typeof ProviderProtocol)[keyof typeof ProviderProtocol]

export type Modality = "text" | "audio" | "image" | "video" | "pdf"

export type CapabilityBooleans = Record<Modality, boolean>

export type ModelCapabilityConfig = {
  text?: boolean
  audio?: boolean
  image?: boolean
  video?: boolean
  pdf?: boolean
  reasoning?: boolean
  tool_call?: boolean
  toolcall?: boolean
  temperature?: boolean
  native_web?: boolean
  attachment?: boolean
  patch_editing?: boolean
  input?: Partial<CapabilityBooleans> | Modality[]
  output?: Partial<CapabilityBooleans> | Modality[]
  modalities?: {
    input?: Modality[]
    output?: Modality[]
  }
}

export type NormalizedModelCapabilities = {
  reasoning: boolean
  tool_call: boolean
  temperature: boolean
  native_web: boolean
  attachment: boolean
  patch_editing: boolean
  input: CapabilityBooleans
  output: CapabilityBooleans
}

export type InferredModelProfile = {
  capabilities: NormalizedModelCapabilities
  limit: { context: number; output: number }
  modalities: { input: Modality[]; output: Modality[] }
  reasoningOptions: string[]
  reasoningModes: Array<{ type: string; values?: string[] }>
}

type ModelCapabilityPatch = Omit<Partial<NormalizedModelCapabilities>, "input" | "output"> & {
  input?: Partial<CapabilityBooleans>
  output?: Partial<CapabilityBooleans>
}

export const defaultModelCapabilities = (): NormalizedModelCapabilities => ({
  reasoning: false,
  tool_call: true,
  temperature: true,
  native_web: false,
  attachment: false,
  patch_editing: false,
  input: {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
  },
  output: {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
  },
})

export function protocolPackage(protocol?: ProviderProtocol) {
  switch (protocol) {
    case ProviderProtocol.OpenAIResponses:
      return "@ai-sdk/openai"
    case ProviderProtocol.AnthropicMessages:
      return "@ai-sdk/anthropic"
    case ProviderProtocol.Gemini:
      return "@ai-sdk/google"
    case ProviderProtocol.OpenAIChat:
    default:
      return "@ai-sdk/openai-compatible"
  }
}

export function normalizeProtocol(input?: string): ProviderProtocol | undefined {
  if (!input) return undefined
  if (isProviderProtocol(input)) return input
  if (input === "openai-compatible" || input === "chat-completions") return ProviderProtocol.OpenAIChat
  if (input === "responses" || input === "openai") return ProviderProtocol.OpenAIResponses
  if (input === "anthropic" || input === "claude") return ProviderProtocol.AnthropicMessages
  if (input === "google" || input === "google-generative-ai") return ProviderProtocol.Gemini
  return undefined
}

export function isProviderProtocol(input: string): input is ProviderProtocol {
  return Object.values(ProviderProtocol).includes(input as ProviderProtocol)
}

export function inferModelCapabilities(input: {
  modelID?: string
  apiID?: string
}): NormalizedModelCapabilities {
  const capabilities = defaultModelCapabilities()
  const model = (input.modelID ?? "").toLowerCase()
  const api = (input.apiID ?? "").toLowerCase()
  const value = [model, api].join(" ")

  if (/glm[-_ ]?5\.3[-_ ]?flash/.test(value)) {
    capabilities.reasoning = true
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = true
    capabilities.patch_editing = true
    capabilities.input.image = true
    capabilities.input.video = true
    capabilities.input.pdf = true
    return capabilities
  }

  const catalog = lookupModelCatalog(input)

  if (catalog) {
    capabilities.reasoning = catalog.r
    capabilities.tool_call = catalog.t
    if (/ox-alpha/.test(value)) capabilities.tool_call = false
    capabilities.temperature = /mimo/.test(value) ? false : catalog.v
    capabilities.input = modalityBooleans(catalog.i)
    capabilities.output = modalityBooleans(catalog.o)
    capabilities.attachment = catalog.i.some((item) => item !== "text")
    capabilities.patch_editing = capabilities.attachment
    capabilities.native_web = /search|web|grounding/.test(value)
    return capabilities
  }

  // Cross-provider model-name signals. These are applied before family
  // branches so newly released aliases still receive a useful profile.
  if (/(?:reasoning|think(?:ing)?|deep[-_ ]?research|r1|qwq|codex|o[1-9])/.test(value)) {
    capabilities.reasoning = !/(?:no[-_ ]?think|non[-_ ]?reasoning|chat[-_ ]?latest)/.test(value)
  }
  if (/(?:vision|multimodal|\bvl\b|omni|image|audio|video|pdf)/.test(value)) {
    capabilities.attachment = true
    capabilities.input.image ||= /vision|multimodal|\bvl\b|omni|image/.test(value)
    capabilities.input.audio ||= /audio|omni/.test(value)
    capabilities.input.video ||= /video|omni/.test(value)
    capabilities.input.pdf ||= /pdf|vision|multimodal|\bvl\b|omni/.test(value)
    capabilities.patch_editing = true
  }
  if (/(?:dall[- ]?e|imagen|flux|recraft|seedream|grok[- ]?imagine)/.test(value)) {
    capabilities.output.image = true
  }
  if (/(?:tts|text[- ]?to[- ]?speech|music|voice)/.test(value)) capabilities.output.audio = true
  if (/(?:sora|veo|runway|kling|seedance|video[- ]?generation)/.test(value)) capabilities.output.video = true

  if (/anthropic|claude/.test(value)) {
    capabilities.reasoning = /opus|sonnet|4|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = true
    capabilities.patch_editing = true
    capabilities.input.image = true
    capabilities.input.pdf = true
    return capabilities
  }

  if (/gemini/.test(value)) {
    capabilities.reasoning = /gemini-(2\.5|3|pro)|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = true
    capabilities.patch_editing = true
    capabilities.input.image = true
    capabilities.input.audio = true
    capabilities.input.video = true
    capabilities.input.pdf = true
    capabilities.native_web = /search|grounding|web/.test(value)
    return capabilities
  }

  if (/\bo\d|gpt-|codex/.test(value)) {
    capabilities.reasoning = /\bo\d|gpt-[5-9]|codex/.test(value) && !/(?:chat|instant|nothink)/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = !/\bo\d|gpt-[5-9]/.test(value)
    capabilities.attachment = true
    capabilities.patch_editing = true
    capabilities.input.image = !/embedding|audio|tts|realtime/.test(value)
    capabilities.input.audio = /gpt-4o|gpt-4\.1|omni|audio|realtime/.test(value)
    capabilities.input.video = /omni|video/.test(value)
    capabilities.input.pdf = /gpt-[5-9]|gpt-4\.1|gpt-4o|o\d/.test(value)
    capabilities.native_web = /search|web/.test(value)
    return capabilities
  }

  if (/deepseek|r1|reasoner/.test(value)) {
    capabilities.reasoning = /deepseek.*(?:v4|reasoner|r1|thinking)|r1|reasoner|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|vl/.test(value)
    capabilities.patch_editing = true
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/mimo|xiaomi|minimax|mini-max/.test(value)) {
    capabilities.reasoning = /mimo|mini(?:max|min-max)|reason|thinking|r1|coder/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = !capabilities.reasoning
    capabilities.patch_editing = true
    return capabilities
  }

  if (/glm|zhipu|chatglm|hy3/.test(value)) {
    capabilities.reasoning = /glm[-_ ]?5|thinking|reason|r1|hy3/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = !capabilities.reasoning
    capabilities.patch_editing = true
    capabilities.attachment = /vision|vl|4v/.test(value)
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/qwen|qwq|alibaba|dashscope/.test(value)) {
    capabilities.reasoning = /qwen3|qwq|thinking|reasoner|max/.test(value)
    capabilities.tool_call = !/vl|omni|coder.*thinking/.test(value) || /qwen3/.test(value)
    capabilities.temperature = true
    capabilities.attachment = /vl|omni|vision|audio/.test(value)
    capabilities.patch_editing = capabilities.tool_call
    capabilities.input.image = /vl|omni|vision/.test(value)
    capabilities.input.audio = /omni|audio/.test(value)
    capabilities.input.video = /vl|omni|video/.test(value)
    capabilities.input.pdf = capabilities.input.image
    return capabilities
  }

  if (/grok|xai/.test(value)) {
    capabilities.reasoning = /grok-3-mini|grok-4|reasoning/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|grok-4/.test(value)
    capabilities.patch_editing = true
    capabilities.input.image = capabilities.attachment
    capabilities.native_web = /search|web|live/.test(value)
    return capabilities
  }

  if (/mistral|pixtral|devstral|codestral/.test(value)) {
    capabilities.reasoning = /magistral|reasoning/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /pixtral|vision/.test(value)
    capabilities.patch_editing = true
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/kimi|moonshot|k[234]/.test(value)) {
    capabilities.reasoning = /thinking|k[234](?:[._-]?[567])?|reason/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|vl/.test(value)
    capabilities.patch_editing = true
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/llama|meta/.test(value)) {
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|scout|maverick/.test(value)
    capabilities.patch_editing = true
    capabilities.input.image = capabilities.attachment
    return capabilities
  }

  if (/(?:step[- ]?(?:3\.[567]|flash|k)|doubao|seed[- ]?(?:code|thinking)|ernie.*(?:thinking|reason)|hunyuan.*thinking|phi.*reason|nemotron.*(?:thinking|reason)|magistral|trinity.*thinking|command.*reason)/.test(value)) {
    capabilities.reasoning = !/non[-_ ]?reasoning|nothink/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.patch_editing = true
    capabilities.attachment ||= /vision|vl|omni|multimodal/.test(value)
    capabilities.input.image ||= capabilities.attachment
    capabilities.input.pdf ||= capabilities.attachment
    return capabilities
  }

  if (/ox-alpha/.test(value)) {
    capabilities.reasoning = true
    // OpenCode Go exposes ox-alpha as a text/reasoning endpoint. Its current
    // chat route rejects any OpenAI-compatible `tools` payload with upstream
    // error 1210, so advertising tool calls makes every agent turn fail.
    capabilities.tool_call = false
    capabilities.temperature = false
    capabilities.patch_editing = true
    return capabilities
  }

  return capabilities
}

export function inferModelLimits(input: { modelID?: string; apiID?: string }) {
  const value = `${input.modelID ?? ""} ${input.apiID ?? ""}`.toLowerCase()
  if (/glm[-_ ]?5\.3[-_ ]?flash/.test(value)) return { context: 1_000_000, output: 128_000 }
  const catalog = lookupModelCatalog(input)
  if (catalog) return { context: catalog.c, output: catalog.x }
  if (/gpt-5\.[5-9]|gpt-5\.6|gpt-(?:luna|sol|terra)/.test(value)) return { context: 1_050_000, output: 128_000 }
  if (/minimax-m3/.test(value)) return { context: 1_000_000, output: 131_072 }
  if (/minimax-m2\.[57]/.test(value)) return { context: 204_800, output: 131_072 }
  if (/kimi.*k3|k3.*kimi/.test(value)) return { context: 1_048_576, output: 131_072 }
  if (/mimo.*v2\.5|mimo-v2\.5/.test(value)) return { context: 1_048_576, output: 131_072 }
  if (/mimo-v2-pro/.test(value)) return { context: 1_048_576, output: 131_072 }
  if (/mimo-v2-omni/.test(value)) return { context: 262_144, output: 131_072 }
  if (/deepseek.*v4/.test(value)) return { context: 1_048_576, output: 131_072 }
  if (/glm.*5\.2|glm-5\.2/.test(value)) return { context: 1_000_000, output: 131_072 }
  if (/glm.*5\.3|glm-5\.3|glm.*5\.1|glm-5\.1|glm-5(?:$|[-_ ])/.test(value)) return { context: 202_752, output: 131_072 }
  if (/kimi.*k[23]\.[567]|k[23]\.[567].*kimi/.test(value)) return { context: 262_144, output: 262_144 }
  if (/qwen.*3\.[5678]|qwen3\.[5678]/.test(value)) return { context: 1_000_000, output: 65_536 }
  if (/step[- ]?(?:3\.[567]|flash)|doubao|seed[- ]?(?:code|thinking)/.test(value)) return { context: 256_000, output: 128_000 }
  if (/magistral|mistral|pixtral|devstral|codestral/.test(value)) return { context: 256_000, output: 32_768 }
  if (/command|cohere|ernie|hunyuan|phi|nemotron|trinity/.test(value)) return { context: 131_072, output: 32_768 }
  if (/mimo|hy3|ox-alpha/.test(value)) return { context: 262_144, output: 32_768 }
  if (/claude|anthropic/.test(value)) return { context: 1_000_000, output: 64_000 }
  if (/gemini/.test(value)) return { context: 1_000_000, output: 65_536 }
  if (/gpt-5|o[1-9]|codex/.test(value)) return { context: 400_000, output: 128_000 }
  if (/deepseek|reasoner|r1/.test(value)) return { context: 128_000, output: 16_000 }
  if (/qwen|qwq|qwen3/.test(value)) return { context: 262_144, output: 32_768 }
  if (/kimi|moonshot|k2/.test(value)) return { context: 131_072, output: 16_384 }
  if (/glm|zhipu|chatglm/.test(value)) return { context: 131_072, output: 16_384 }
  if (/grok/.test(value)) return { context: 131_072, output: 32_768 }
  if (/mistral|pixtral|devstral|codestral/.test(value)) return { context: 131_072, output: 32_768 }
  if (/llama|meta/.test(value)) return { context: 131_072, output: 8_192 }
  return { context: 128_000, output: 16_000 }
}

export function inferModelReasoningOptions(input: { modelID?: string; apiID?: string; reasoning?: boolean }) {
  const value = `${input.modelID ?? ""} ${input.apiID ?? ""}`.toLowerCase()
  if (/glm[-_ ]?5\.3[-_ ]?flash/.test(value)) return ["low", "high", "max"]
  const catalog = lookupModelCatalog(input)
  const reasoning = input.reasoning ?? inferModelCapabilities(input).reasoning
  if (!reasoning) return []
  const catalogEffort = catalog?.m?.find((mode) => mode.type === "effort")?.values
  if (catalogEffort?.length) return catalogEffort
  if (/mimo|mini[- ]?max/.test(value)) return []
  if (/step[- ]?3\.5|step[- ]?3\.6/.test(value)) return ["low", "high"]
  if (/deepseek.*(?:v4|v3\.2|v3\.1|reasoner|thinking)|glm[-_ ]?5(?:\.|-|$)/.test(value)) return ["high", "max"]
  if (/kimi[-_ ]?k3/.test(value)) return ["low", "high", "max"]
  if (/hy3/.test(value)) return ["none", "low", "high"]
  if (/grok-4\.3/.test(value)) return ["none", "low", "medium", "high"]
  if (/grok-4\.20.*multi/.test(value)) return ["low", "medium", "high", "xhigh"]
  if (/claude.*4(?:\.|-|$)/.test(value)) return ["low", "medium", "high", "xhigh", "max"]
  if (/gemini-2\.5/.test(value)) return ["none", "low", "medium", "high"]
  if (/gemini-3/.test(value)) return ["minimal", "low", "medium", "high"]
  if (/gpt-5.*pro/.test(value)) return ["medium", "high", "xhigh"]
  if (/gpt-5.*codex/.test(value)) return ["low", "medium", "high"]
  if (/gpt-5/.test(value)) return ["minimal", "low", "medium", "high"]
  if (/gpt|codex|\bo\d/.test(value)) return ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
  if (/glm|zhipu|chatglm/.test(value)) return ["high", "max"]
  return []
}

export function inferModelProfile(input: { modelID?: string; apiID?: string }): InferredModelProfile {
  const capabilities = inferModelCapabilities(input)
  const value = `${input.modelID ?? ""} ${input.apiID ?? ""}`.toLowerCase()
  if (!lookupModelCatalog(input) && /minimax-m3/.test(value)) {
    capabilities.attachment = true
    capabilities.input.image = true
    capabilities.input.video = true
  }
  if (!lookupModelCatalog(input) && /kimi.*k3|k3.*kimi|qwen3\.[5678]/.test(value)) {
    capabilities.attachment = true
    capabilities.input.image = true
    capabilities.input.video = true
    capabilities.input.pdf = true
  }
  return {
    capabilities,
    limit: inferModelLimits(input),
    modalities: modalitiesFromCapabilities(capabilities),
    reasoningOptions: inferModelReasoningOptions({ ...input, reasoning: capabilities.reasoning }),
    reasoningModes: inferModelReasoningModes(input, capabilities.reasoning),
  }
}

function inferModelReasoningModes(input: { modelID?: string; apiID?: string }, reasoning: boolean) {
  if (!reasoning) return []
  const catalog = lookupModelCatalog(input)
  if (catalog?.m) return catalog.m.map((mode) => ({ ...mode }))
  const options = inferModelReasoningOptions({ ...input, reasoning })
  return options.length ? [{ type: "effort", values: options }] : []
}

function lookupModelCatalog(input: { modelID?: string; apiID?: string }) {
  for (const value of [input.modelID, input.apiID]) {
    if (!value) continue
    const key = normalizeModelName(value)
    const entry = MODEL_NAME_CATALOG[key]
    if (entry) return entry
  }
  return undefined
}

function normalizeModelName(value: string) {
  return value.toLowerCase().split("/").pop()?.replace(/[^a-z0-9]/g, "") ?? ""
}

function modalityBooleans(input: string[]): CapabilityBooleans {
  return {
    text: input.includes("text"),
    audio: input.includes("audio"),
    image: input.includes("image"),
    video: input.includes("video"),
    pdf: input.includes("pdf"),
  }
}

export function normalizeModelCapabilities(input: {
  base?: ModelCapabilityPatch
  inferred?: ModelCapabilityPatch
  legacy?: ModelCapabilityConfig
  explicit?: ModelCapabilityConfig
  /** Apply model-name inference after persisted/catalog declarations. */
  inferredLast?: ModelCapabilityPatch
}): NormalizedModelCapabilities {
  const result = mergeCapabilities(defaultModelCapabilities(), input.base)
  mergeCapabilities(result, input.inferred)
  applyConfig(result, input.legacy)
  applyConfig(result, input.explicit)
  mergeCapabilities(result, input.inferredLast)
  result.attachment =
    result.attachment || result.input.image || result.input.audio || result.input.video || result.input.pdf
  return result
}

export function modalitiesFromCapabilities(input: NormalizedModelCapabilities) {
  return {
    input: modalityList(input.input),
    output: modalityList(input.output),
  }
}

function mergeCapabilities(
  target: NormalizedModelCapabilities,
  patch?: ModelCapabilityPatch,
): NormalizedModelCapabilities {
  if (!patch) return target
  if (patch.reasoning !== undefined) target.reasoning = patch.reasoning
  if (patch.tool_call !== undefined) target.tool_call = patch.tool_call
  if (patch.temperature !== undefined) target.temperature = patch.temperature
  if (patch.native_web !== undefined) target.native_web = patch.native_web
  if (patch.attachment !== undefined) target.attachment = patch.attachment
  if (patch.patch_editing !== undefined) target.patch_editing = patch.patch_editing
  if (patch.input) target.input = { ...target.input, ...patch.input }
  if (patch.output) target.output = { ...target.output, ...patch.output }
  return target
}

function applyConfig(target: NormalizedModelCapabilities, config?: ModelCapabilityConfig) {
  if (!config) return
  if (config.reasoning !== undefined) target.reasoning = config.reasoning
  if (config.tool_call !== undefined) target.tool_call = config.tool_call
  if (config.toolcall !== undefined) target.tool_call = config.toolcall
  if (config.temperature !== undefined) target.temperature = config.temperature
  if (config.native_web !== undefined) target.native_web = config.native_web
  if (config.attachment !== undefined) target.attachment = config.attachment
  if (config.patch_editing !== undefined) target.patch_editing = config.patch_editing
  if (config.text !== undefined) target.input.text = config.text
  if (config.audio !== undefined) target.input.audio = config.audio
  if (config.image !== undefined) target.input.image = config.image
  if (config.video !== undefined) target.input.video = config.video
  if (config.pdf !== undefined) target.input.pdf = config.pdf
  if (config.input !== undefined) target.input = normalizeModalities(target.input, config.input)
  if (config.output !== undefined) target.output = normalizeModalities(target.output, config.output)
  if (config.modalities?.input !== undefined) target.input = normalizeModalities(target.input, config.modalities.input)
  if (config.modalities?.output !== undefined)
    target.output = normalizeModalities(target.output, config.modalities.output)
}

function normalizeModalities(current: CapabilityBooleans, input: Partial<CapabilityBooleans> | Modality[]) {
  if (Array.isArray(input)) {
    return {
      text: input.includes("text"),
      audio: input.includes("audio"),
      image: input.includes("image"),
      video: input.includes("video"),
      pdf: input.includes("pdf"),
    }
  }
  return { ...current, ...input }
}

function modalityList(input: CapabilityBooleans): Modality[] {
  return (["text", "audio", "image", "video", "pdf"] as const).filter((key) => input[key])
}
