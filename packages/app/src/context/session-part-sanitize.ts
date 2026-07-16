import type { Part } from "@lfcode-ai/sdk/v2/client"
import { dropInlineImageCacheForParts, stashInlineImagePart } from "@lfcode-ai/ui/inline-image-cache"

type FilePart = Extract<Part, { type: "file" }>
type ToolPart = Extract<Part, { type: "tool" }>
const TOOL_OUTPUT_MAX_CHARS = 24_000
const TOOL_OUTPUT_HEAD_CHARS = 12_000
const TOOL_OUTPUT_TAIL_CHARS = 4_000

function compactToolOutput(output: string) {
  if (output.length <= TOOL_OUTPUT_MAX_CHARS) return output
  const omitted = output.length - TOOL_OUTPUT_HEAD_CHARS - TOOL_OUTPUT_TAIL_CHARS
  return [
    output.slice(0, TOOL_OUTPUT_HEAD_CHARS),
    "",
    `[lfcode truncated large tool output in UI: omitted ${omitted} chars]`,
    "",
    output.slice(-TOOL_OUTPUT_TAIL_CHARS),
  ].join("\n")
}

export function sanitizeSessionPart(part: Part): Part {
  if (part.type === "file") return stashInlineImagePart(part)
  if (part.type !== "tool") return part
  if (part.state.status !== "completed") return part
  const currentAttachments = part.state.attachments
  const output = typeof part.state.output === "string" ? compactToolOutput(part.state.output) : part.state.output
  const attachments = currentAttachments?.map((attachment) => stashInlineImagePart(attachment))
  const changedOutput = output !== part.state.output
  const changedAttachments =
    !!attachments && attachments.some((attachment, index) => attachment !== currentAttachments?.[index])
  if (!changedOutput && !changedAttachments) return part

  return {
    ...part,
    state: {
      ...part.state,
      output,
      attachments: attachments ?? currentAttachments,
    },
  } satisfies ToolPart
}

export function sanitizeSessionParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).map(sanitizeSessionPart)
}

export function dropInlineImageCacheForSessionParts(parts: Part[] | undefined) {
  if (!parts?.length) return
  dropInlineImageCacheForParts(parts.flatMap(collectInlineImageParts))
}

function collectInlineImageParts(part: Part): FilePart[] {
  if (part.type === "file") return [part]
  if (part.type !== "tool") return []
  if (part.state.status !== "completed") return []
  return [...(part.state.attachments ?? [])]
}
