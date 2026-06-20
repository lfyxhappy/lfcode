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
  input: CapabilityBooleans
  output: CapabilityBooleans
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
  providerID?: string
  modelID?: string
  apiID?: string
  protocol?: ProviderProtocol
}): NormalizedModelCapabilities {
  const capabilities = defaultModelCapabilities()
  const provider = (input.providerID ?? "").toLowerCase()
  const model = (input.modelID ?? "").toLowerCase()
  const api = (input.apiID ?? "").toLowerCase()
  const value = [provider, model, api].join(" ")

  if (input.protocol === ProviderProtocol.AnthropicMessages || /anthropic|claude/.test(value)) {
    capabilities.reasoning = /opus|sonnet|4|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = true
    capabilities.input.image = true
    capabilities.input.pdf = true
    return capabilities
  }

  if (input.protocol === ProviderProtocol.Gemini || /gemini|google/.test(value)) {
    capabilities.reasoning = /gemini-(2\.5|3|pro)|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = true
    capabilities.input.image = true
    capabilities.input.audio = true
    capabilities.input.video = true
    capabilities.input.pdf = true
    capabilities.native_web = /search|grounding|web/.test(value)
    return capabilities
  }

  if (/\bo\d|gpt-|openai|codex/.test(value)) {
    capabilities.reasoning = /\bo\d|gpt-[5-9]|codex/.test(value) && !/chat-latest/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = !/\bo\d|gpt-[5-9]/.test(value)
    capabilities.attachment = true
    capabilities.input.image = !/embedding|audio|tts|realtime/.test(value)
    capabilities.input.audio = /gpt-4o|gpt-4\.1|gpt-[5-9]|omni|audio|realtime/.test(value)
    capabilities.input.video = /gpt-[5-9]|omni|video/.test(value)
    capabilities.input.pdf = /gpt-[5-9]|gpt-4\.1|gpt-4o|o\d/.test(value)
    capabilities.native_web = /search|web/.test(value)
    return capabilities
  }

  if (/deepseek|r1|reasoner/.test(value)) {
    capabilities.reasoning = /r1|reasoner|thinking/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|vl/.test(value)
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/qwen|qwq|alibaba|dashscope/.test(value)) {
    capabilities.reasoning = /qwen3|qwq|thinking|reasoner|max/.test(value)
    capabilities.tool_call = !/vl|omni|coder.*thinking/.test(value) || /qwen3/.test(value)
    capabilities.temperature = true
    capabilities.attachment = /vl|omni|vision|audio/.test(value)
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
    capabilities.input.image = capabilities.attachment
    capabilities.native_web = /search|web|live/.test(value)
    return capabilities
  }

  if (/mistral|pixtral|devstral|codestral/.test(value)) {
    capabilities.reasoning = /magistral|reasoning/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /pixtral|vision/.test(value)
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/kimi|moonshot|k2/.test(value)) {
    capabilities.reasoning = /thinking|k2\.5|k2p5|k2-5/.test(value)
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|vl/.test(value)
    capabilities.input.image = capabilities.attachment
    capabilities.input.pdf = capabilities.attachment
    return capabilities
  }

  if (/llama|meta/.test(value)) {
    capabilities.tool_call = true
    capabilities.temperature = true
    capabilities.attachment = /vision|scout|maverick/.test(value)
    capabilities.input.image = capabilities.attachment
    return capabilities
  }

  return capabilities
}

export function normalizeModelCapabilities(input: {
  base?: ModelCapabilityPatch
  inferred?: ModelCapabilityPatch
  legacy?: ModelCapabilityConfig
  explicit?: ModelCapabilityConfig
}): NormalizedModelCapabilities {
  const result = mergeCapabilities(defaultModelCapabilities(), input.base)
  mergeCapabilities(result, input.inferred)
  applyConfig(result, input.legacy)
  applyConfig(result, input.explicit)
  result.input.text = true
  result.output.text = true
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
