import { getCodeEditorFenceExtension } from "@/components/code-editor/core/language"

export type MessageCodeFileResult =
  | {
      status: "exists"
      data: { exists?: boolean; content: string; checksum?: string }
    }
  | { status: "missing" }
  | { status: "error" }

export type MessageCodeFileRead = (input: { path: string }) => Promise<{
  data?: { exists?: boolean; content: string; checksum?: string }
}>

export async function readMessageCodeFile(read: MessageCodeFileRead, path: string): Promise<MessageCodeFileResult> {
  try {
    const result = await read({ path })
    if (result.data?.exists !== true) return { status: "missing" }
    return { status: "exists", data: result.data }
  } catch {
    return { status: "error" }
  }
}

export function messageCodeFileStatus(result?: MessageCodeFileResult) {
  return result?.status ?? "pending"
}

export function createMessageCodeScratchPath(input: {
  sessionID: string
  messageID: string
  partID: string
  blockIndex: number
  language: string
}) {
  const extension = getCodeEditorFenceExtension(input.language) ?? ".txt"
  const group = input.language.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "code"
  return `.lfcode/scratch/code/${group}/${input.sessionID}/${input.messageID}-${input.partID}-${input.blockIndex}${extension}`
}
