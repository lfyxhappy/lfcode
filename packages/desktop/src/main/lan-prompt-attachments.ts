const MEBIBYTE = 1024 * 1024

export const LAN_PROMPT_MAX_ATTACHMENT_FILES = 4
export const LAN_PROMPT_MAX_ATTACHMENT_BYTES = 2 * MEBIBYTE
export const LAN_PROMPT_MAX_TOTAL_ATTACHMENT_BYTES = 6 * MEBIBYTE
export const LAN_PROMPT_MAX_REQUEST_BYTES = 7 * MEBIBYTE
export const LAN_PROMPT_MAX_TEXT_CHARS = 32_000

type LanPromptTextPart = {
  type: "text"
  text: string
}

type LanPromptFilePart = {
  type: "file"
  mime: string
  filename: string
  url: string
}

export type LanPromptPayload = {
  modelRef?: string
  agent?: string
  delivery: "default" | "steer"
  parts: Array<LanPromptTextPart | LanPromptFilePart>
}

export class LanPromptPayloadError extends Error {
  constructor(
    readonly code: "invalid_request" | "too_many_attachments" | "attachment_too_large" | "attachments_too_large" | "unsupported_attachment_type",
    message: string,
  ) {
    super(message)
  }
}

export async function parseLanPromptPayload(request: Request): Promise<LanPromptPayload> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.startsWith("multipart/form-data")) return parseMultipartPrompt(request)
  if (contentType.includes("application/json")) return parseJsonPrompt(request)
  throw new LanPromptPayloadError("invalid_request", "Use JSON text or multipart form data for a LAN prompt")
}

async function parseJsonPrompt(request: Request): Promise<LanPromptPayload> {
  const body = await request.json().catch(() => undefined)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new LanPromptPayloadError("invalid_request", "A LAN prompt JSON object is required")
  }

  const input = body as Record<string, unknown>
  const text = requirePromptText(input.text)
  return {
    ...promptOptions(input),
    parts: [{ type: "text", text }],
  }
}

async function parseMultipartPrompt(request: Request): Promise<LanPromptPayload> {
  const form = await request.formData().catch(() => undefined)
  if (!form) throw new LanPromptPayloadError("invalid_request", "The LAN attachment form could not be read")

  const text = optionalFormText(form, "text")?.trim() ?? ""
  if (text.length > LAN_PROMPT_MAX_TEXT_CHARS) {
    throw new LanPromptPayloadError("invalid_request", `Prompt text must be at most ${LAN_PROMPT_MAX_TEXT_CHARS} characters`)
  }

  const attachments = form.getAll("files")
  if (attachments.length > LAN_PROMPT_MAX_ATTACHMENT_FILES) {
    throw new LanPromptPayloadError("too_many_attachments", `A LAN prompt can include at most ${LAN_PROMPT_MAX_ATTACHMENT_FILES} attachments`)
  }

  const files = await Promise.all(attachments.map((attachment) => parseAttachment(attachment)))
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0)
  if (total > LAN_PROMPT_MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new LanPromptPayloadError("attachments_too_large", `LAN attachments must total at most ${formatBytes(LAN_PROMPT_MAX_TOTAL_ATTACHMENT_BYTES)}`)
  }
  if (!text && files.length === 0) throw new LanPromptPayloadError("invalid_request", "A prompt text or attachment is required")

  return {
    ...promptOptions({
      modelRef: optionalFormText(form, "modelRef"),
      agent: optionalFormText(form, "agent"),
      delivery: optionalFormText(form, "delivery"),
    }),
    parts: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...files.map((file) => ({
        type: "file" as const,
        mime: file.mime,
        filename: file.filename,
        url: `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`,
      })),
    ],
  }
}

async function parseAttachment(value: FormDataEntryValue) {
  if (typeof value === "string" || !isUploadedFile(value)) {
    throw new LanPromptPayloadError("invalid_request", "Each LAN attachment must be an uploaded file")
  }
  if (value.size <= 0) throw new LanPromptPayloadError("invalid_request", "LAN attachments cannot be empty")
  if (value.size > LAN_PROMPT_MAX_ATTACHMENT_BYTES) {
    throw new LanPromptPayloadError("attachment_too_large", `Each LAN attachment must be at most ${formatBytes(LAN_PROMPT_MAX_ATTACHMENT_BYTES)}`)
  }

  const bytes = new Uint8Array(await value.arrayBuffer())
  if (bytes.byteLength > LAN_PROMPT_MAX_ATTACHMENT_BYTES) {
    throw new LanPromptPayloadError("attachment_too_large", `Each LAN attachment must be at most ${formatBytes(LAN_PROMPT_MAX_ATTACHMENT_BYTES)}`)
  }

  const declared = value.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const detected = detectedMediaMime(bytes)
  if (detected) {
    if (declared && (!isPermittedMediaMime(declared) || declared !== detected)) {
      throw new LanPromptPayloadError("unsupported_attachment_type", "LAN attachments only support images, PDFs, and ordinary text")
    }
    return { bytes, filename: safeFilename(value.name), mime: detected }
  }

  if (declared && !isPermittedTextMime(declared) && declared !== "application/octet-stream") {
    throw new LanPromptPayloadError("unsupported_attachment_type", "LAN attachments only support images, PDFs, and ordinary text")
  }
  if (!isOrdinaryText(bytes)) {
    throw new LanPromptPayloadError("unsupported_attachment_type", "LAN attachments only support images, PDFs, and ordinary text")
  }

  return { bytes, filename: safeFilename(value.name), mime: "text/plain" }
}

function promptOptions(input: Record<string, unknown>) {
  return {
    modelRef: optionalInputString(input.modelRef, "modelRef"),
    agent: optionalInputString(input.agent, "agent"),
    delivery: input.delivery === "steer" ? ("steer" as const) : ("default" as const),
  }
}

function requirePromptText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new LanPromptPayloadError("invalid_request", "A prompt text is required when no attachment is uploaded")
  }
  const text = value.trim()
  if (text.length > LAN_PROMPT_MAX_TEXT_CHARS) {
    throw new LanPromptPayloadError("invalid_request", `Prompt text must be at most ${LAN_PROMPT_MAX_TEXT_CHARS} characters`)
  }
  return text
}

function optionalInputString(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return
  if (typeof value !== "string" || value.length > 200) {
    throw new LanPromptPayloadError("invalid_request", `${field} must be a short string`)
  }
  return value
}

function optionalFormText(form: FormData, name: string) {
  const values = form.getAll(name)
  if (values.length === 0) return
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new LanPromptPayloadError("invalid_request", `${name} must be supplied once as text`)
  }
  return values[0]
}

function isUploadedFile(value: Exclude<FormDataEntryValue, string>): value is File {
  return typeof value === "object" && "arrayBuffer" in value && typeof value.arrayBuffer === "function" && "name" in value && typeof value.name === "string"
}

function detectedMediaMime(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}

function isPermittedMediaMime(value: string) {
  return value === "application/pdf" || value === "image/png" || value === "image/jpeg" || value === "image/gif" || value === "image/webp"
}

function isPermittedTextMime(value: string) {
  return value.startsWith("text/") || [
    "application/json",
    "application/ld+json",
    "application/toml",
    "application/x-toml",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
  ].includes(value)
}

function isOrdinaryText(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  let controls = 0
  for (const byte of bytes) {
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1
  }
  return controls / bytes.length <= 0.3
}

function safeFilename(value: string) {
  const name = value.replaceAll("\\", "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "_").trim().slice(0, 160)
  return name || "attachment"
}

function formatBytes(value: number) {
  return `${Math.floor(value / MEBIBYTE)} MiB`
}
