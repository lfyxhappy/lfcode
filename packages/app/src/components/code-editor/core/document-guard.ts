const MAX_EDITOR_CHARS = 200_000
const MAX_EDITOR_LINES = 5_000

export function getCodeEditorDocumentGuard(value: string) {
  const lineCount = countLines(value)
  const tooLarge = value.length > MAX_EDITOR_CHARS || lineCount > MAX_EDITOR_LINES
  return {
    tooLarge,
    lineCount,
    charCount: value.length,
  }
}

function countLines(value: string) {
  if (!value) return 1
  let lines = 1
  for (const char of value) {
    if (char === "\n") lines += 1
  }
  return lines
}
