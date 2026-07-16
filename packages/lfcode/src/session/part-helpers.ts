import { MessageV2 } from "./message-v2"

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") +
    "}"
  )
}

export function stepSignature(parts: MessageV2.Part[]): string | undefined {
  const segments: string[] = []
  for (const part of parts) {
    if (part.type === "tool") {
      segments.push("tool:" + part.tool + ":" + stableStringify(part.state.input ?? {}))
    }
  }
  if (segments.length === 0) return undefined
  return segments.join("\n")
}

export function repeatedToolValidationFailure(input: {
  messages: MessageV2.WithParts[]
  threshold: number
}) {
  const signatures: string[] = []
  for (let i = input.messages.length - 1; i >= 0 && signatures.length < input.threshold; i--) {
    const message = input.messages[i]
    if (message.info.role !== "assistant" || !message.info.finish) continue
    const tools = message.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool")
    if (tools.length !== 1) return false
    const tool = tools[0]
    if (tool.state.status !== "error" || !tool.state.error.includes("tool was called with invalid arguments")) return false
    signatures.push(`${tool.tool}:${stableStringify(tool.state.input ?? {})}:${tool.state.error}`)
  }
  return signatures.length === input.threshold && signatures.every((signature) => signature === signatures[0])
}

export function sameToolFailureCount(input: {
  messages: MessageV2.WithParts[]
  tool: string
  toolInput: unknown
  error: string
}) {
  const signature = `${input.tool}:${stableStringify(input.toolInput)}:${input.error}`
  return input.messages.reduce(
    (count, message) =>
      count +
      message.parts.filter(
        (part): part is MessageV2.ToolPart =>
          part.type === "tool" &&
          part.tool === input.tool &&
          part.state.status === "error" &&
          `${part.tool}:${stableStringify(part.state.input ?? {})}:${part.state.error}` === signature,
      ).length,
    0,
  )
}

export function isRealUserPart(part: MessageV2.Part) {
  if (part.type !== "text") return true
  if (part.synthetic || part.ignored) return false
  return part.text.trim().length > 0
}
