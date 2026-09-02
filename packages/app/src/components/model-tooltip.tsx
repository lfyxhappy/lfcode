import { Show, type Component } from "solid-js"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"
import { useLanguage } from "@/context/language"

type InputKey = "text" | "image" | "audio" | "video" | "pdf"
type InputMap = Record<InputKey, boolean>
type CapabilityKey = InputKey | "attachment" | "tool_call" | "reasoning" | "patch_editing" | "native_web" | "temperature"
type CapabilityMap = Record<CapabilityKey, boolean>

type ModelInfo = {
  id: string
  name: string
  provider: {
    name: string
  }
  capabilities?: {
    reasoning: boolean
    attachment?: boolean
    patch_editing?: boolean
    input: InputMap
    tools?: boolean
    tool_call?: boolean
    toolcall?: boolean
    temperature?: boolean
    native_web?: boolean
  }
  modalities?: {
    input: Array<string>
  }
  attachment?: boolean
  tool_call?: boolean
  reasoning?: boolean
  patch_editing?: boolean
  native_web?: boolean
  temperature?: boolean
  limit: {
    context: number
  }
  metadata?: {
    source: string
    updatedAt?: string
  }
}

export const ModelTooltip: Component<{ model: ModelInfo; latest?: boolean; free?: boolean }> = (props) => {
  const language = useLanguage()
  const sourceName = (model: ModelInfo) => {
    const value = `${model.id} ${model.name}`.toLowerCase()

    if (/claude|anthropic/.test(value)) return language.t("model.provider.anthropic")
    if (/gpt|o[1-4]|codex|openai/.test(value)) return language.t("model.provider.openai")
    if (/gemini|palm|bard|google/.test(value)) return language.t("model.provider.google")
    if (/grok|xai/.test(value)) return language.t("model.provider.xai")
    if (/llama|meta/.test(value)) return language.t("model.provider.meta")

    return model.provider.name
  }
  const inputLabel = (value: string) => {
    if (value === "text") return language.t("model.input.text")
    if (value === "image") return language.t("model.input.image")
    if (value === "audio") return language.t("model.input.audio")
    if (value === "video") return language.t("model.input.video")
    if (value === "pdf") return language.t("model.input.pdf")
    return value
  }
  const capabilityLabel = (value: CapabilityKey) => {
    if (value === "tool_call") return language.t("model.capability.tool_call")
    if (value === "reasoning") return language.t("model.capability.reasoning")
    if (value === "attachment") return language.t("model.capability.attachment")
    if (value === "patch_editing") return language.t("model.capability.patch_editing")
    if (value === "native_web") return language.t("model.capability.native_web")
    if (value === "temperature") return language.t("model.capability.temperature")
    return inputLabel(value)
  }
  const title = () => {
    const tags: Array<string> = []
    if (props.latest) tags.push(language.t("model.tag.latest"))
    if (props.free) tags.push(language.t("model.tag.free"))
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""
    return `${sourceName(props.model)} ${props.model.name}${suffix}`
  }
  const inputs = () => {
    if (props.model.capabilities) {
      const input = props.model.capabilities.input
      const order: Array<InputKey> = ["text", "image", "audio", "video", "pdf"]
      const entries = order.filter((key) => input[key]).map((key) => inputLabel(key))
      return entries.length ? entries.join(", ") : undefined
    }
    const raw = props.model.modalities?.input
    if (!raw) return
    const entries = raw.map((value) => inputLabel(value))
    return entries.length ? entries.join(", ") : undefined
  }
  const reasoning = () => {
    if (props.model.capabilities)
      return props.model.capabilities.reasoning
        ? language.t("model.tooltip.reasoning.allowed")
        : language.t("model.tooltip.reasoning.none")
    return props.model.reasoning
      ? language.t("model.tooltip.reasoning.allowed")
      : language.t("model.tooltip.reasoning.none")
  }
  const context = () => language.t("model.tooltip.context", { limit: formatTokenCount(props.model.limit.context) })
  const capabilities = () => {
    const next: CapabilityMap = {
      text: true,
      image: !!props.model.capabilities?.input.image,
      audio: !!props.model.capabilities?.input.audio,
      video: !!props.model.capabilities?.input.video,
      pdf: !!props.model.capabilities?.input.pdf,
      attachment: !!props.model.capabilities?.attachment || !!props.model.attachment,
      tool_call:
        !!props.model.capabilities?.tools ||
        !!props.model.capabilities?.toolcall ||
        !!props.model.capabilities?.tool_call ||
        !!props.model.tool_call,
      reasoning: !!props.model.capabilities?.reasoning || !!props.model.reasoning,
      patch_editing: !!props.model.capabilities?.patch_editing || !!props.model.patch_editing,
      native_web: !!props.model.capabilities?.native_web || !!props.model.native_web,
      temperature: props.model.capabilities?.temperature ?? props.model.temperature ?? false,
    }
    return (Object.keys(next) as CapabilityKey[]).filter((key) => next[key])
  }

  return (
    <div class="flex flex-col gap-1 py-1">
      <div class="text-13-medium">{title()}</div>
      <Show when={inputs()}>
        {(value) => (
          <div class="text-12-regular text-text-invert-base">
            {language.t("model.tooltip.allows", { inputs: value() })}
          </div>
        )}
      </Show>
      {capabilities().length > 0 && (
        <div class="text-12-regular text-text-invert-base">
          {language.t("model.tooltip.capabilities", {
            capabilities: capabilities()
              .map((key) => capabilityLabel(key))
              .join(", "),
          })}
        </div>
      )}
      <div class="text-12-regular text-text-invert-base">{reasoning()}</div>
      <div class="text-12-regular text-text-invert-base">{context()}</div>
      <Show when={props.model.metadata}>
        {(metadata) => (
          <div class="text-12-regular text-text-invert-base">
            {language.t("model.tooltip.source", {
              source: metadata().source,
              updatedAt: metadata().updatedAt ?? language.t("model.tooltip.unknown"),
            })}
          </div>
        )}
      </Show>
    </div>
  )
}
