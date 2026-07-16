import { getCodeEditorFenceExtension } from "@/components/code-editor/core/language"

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
