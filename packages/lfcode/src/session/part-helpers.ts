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
  userID?: string
}) {
  const signatures: string[] = []
  for (let i = input.messages.length - 1; i >= 0 && signatures.length < input.threshold; i--) {
    const message = input.messages[i]
    // Validation retries are local to one user turn. Older assistant tool errors
    // must never prevent a newly admitted user message from reaching the model.
    if (input.userID && message.info.role === "user") break
    if (message.info.role !== "assistant" || !message.info.finish) continue
    const tools = message.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool")
    if (tools.length !== 1) return false
    const tool = tools[0]
    if (tool.state.status !== "error" || !isRetryableToolValidationFailure(tool.state.error)) return false
    signatures.push(toolFailureSignature(tool.tool, tool.state.error))
  }
  return signatures.length === input.threshold && signatures.every((signature) => signature === signatures[0])
}

export function sameToolFailureCount(input: {
  messages: MessageV2.WithParts[]
  tool: string
  toolInput: unknown
  error: string
}) {
  const signature = toolFailureSignature(input.tool, input.error)
  return input.messages.reduce(
    (count, message) =>
      count +
      message.parts.filter(
        (part): part is MessageV2.ToolPart =>
          part.type === "tool" &&
          part.tool === input.tool &&
          part.state.status === "error" &&
          toolFailureSignature(part.tool, part.state.error) === signature,
      ).length,
    0,
  )
}

export function isRetryableToolValidationFailure(error: string) {
  return (
    structuredToolError(error)?.category === "schema" ||
    /tool was called with invalid arguments/i.test(error) ||
    error.startsWith("This Windows terminal tool only accepts PowerShell 7 (`pwsh`) syntax.")
  )
}

function toolFailureSignature(tool: string, error: string) {
  const structured = structuredToolError(error)
  if (structured) {
    const fields = Array.isArray(structured.fields)
      ? structured.fields.filter((field): field is string => typeof field === "string").sort()
      : typeof structured.field === "string"
        ? [structured.field]
        : []
    return `${tool}:${structured.category ?? "runtime"}:${fields.join(",")}:${normalizeFailureText(structured.message ?? error)}`
  }
  return `${tool}:${normalizeFailureText(error)}`
}

function structuredToolError(error: string): Record<string, unknown> | undefined {
  const match = /^\[tool_error\]\s+(\{.+\})/u.exec(error)
  if (!match) return
  try {
    const value = JSON.parse(match[1])
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  } catch {
    return
  }
}

function normalizeFailureText(value: unknown) {
  return String(value)
    .replace(/\bT\d+(?:\.\d+)*\b/gu, "<task>")
    .replace(/\b(?:ses|msg|part)_[A-Za-z0-9]+\b/gu, "<id>")
    .replace(/\b[a-f0-9]{64}\b/giu, "<hash>")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
}

export function isRealUserPart(part: MessageV2.Part) {
  if (part.type !== "text") return true
  if (part.synthetic || part.ignored) return false
  return part.text.trim().length > 0
}
