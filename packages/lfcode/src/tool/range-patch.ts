export type RangeEdit = {
  startLine: number
  startChar?: number
  endLine: number
  endChar?: number
  newText: string
}

export function buildRangePatchText(filePath: string, content: string, params: RangeEdit) {
  const normalizedContent = normalizeLineEndings(content)
  const normalizedLines = getVisibleLines(normalizedContent)
  const lineEnding = detectLineEnding(content)
  const totalLines = normalizedLines.length
  const startLineIndex = params.startLine - 1
  const endLineIndex = params.endLine - 1

  if (endLineIndex < startLineIndex) throw new Error("endLine must be greater than or equal to startLine")
  if (startLineIndex >= totalLines) throw new Error(`startLine ${params.startLine} exceeds file length ${totalLines}`)
  if (endLineIndex >= totalLines) throw new Error(`endLine ${params.endLine} exceeds file length ${totalLines}`)

  const startLine = normalizedLines[startLineIndex] ?? ""
  const endLine = normalizedLines[endLineIndex] ?? ""
  const startChar = params.startChar ?? 1
  const endChar = params.endChar ?? endLine.length + 1

  validateCharacter("startChar", startChar, startLine.length + 1, params.startLine)
  validateCharacter("endChar", endChar, endLine.length + 1, params.endLine)
  if (startLineIndex === endLineIndex && startChar > endChar) {
    throw new Error("startChar must be less than or equal to endChar when startLine equals endLine")
  }

  const prefix = startLine.slice(0, startChar - 1)
  const suffix = endLine.slice(endChar - 1)
  const replacement = normalizeLineEndings(params.newText)
  const oldAffected = normalizedLines.slice(startLineIndex, endLineIndex + 1)
  const nextAffected = `${prefix}${replacement}${suffix}`.split("\n")

  if (sameLines(oldAffected, nextAffected)) throw new Error("No changes to apply.")

  if (content === "" && totalLines === 1 && oldAffected.length === 1 && oldAffected[0] === "") {
    return renderAddFilePatch(filePath, nextAffected, lineEnding)
  }

  const beforeContext = startLineIndex > 0 ? toPatchLine(normalizedLines[startLineIndex - 1], lineEnding) : undefined
  const afterContext = endLineIndex + 1 < totalLines ? toPatchLine(normalizedLines[endLineIndex + 1], lineEnding) : undefined
  const oldPatchLines = oldAffected.map((line) => toPatchLine(line, lineEnding))
  const newPatchLines = nextAffected.map((line) => toPatchLine(line, lineEnding))
  const eof = endLineIndex === totalLines - 1 && !afterContext

  return [
    "*** Begin Patch",
    `*** Update File: ${filePath}`,
    "@@",
    ...(beforeContext ? [` ${beforeContext}`] : []),
    ...oldPatchLines.map((line) => `-${line}`),
    ...newPatchLines.map((line) => `+${line}`),
    ...(afterContext ? [` ${afterContext}`] : []),
    ...(eof ? ["*** End of File"] : []),
    "*** End Patch",
  ].join("\n")
}

function renderAddFilePatch(filePath: string, lines: string[], lineEnding: "\n" | "\r\n") {
  return [
    "*** Begin Patch",
    `*** Add File: ${filePath}`,
    ...lines.map((line) => `+${toPatchLine(line, lineEnding)}`),
    "*** End Patch",
  ].join("\n")
}

function normalizeLineEndings(text: string) {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function getVisibleLines(content: string) {
  const lines = content.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") return lines.slice(0, -1)
  return lines
}

function validateCharacter(label: string, value: number, max: number, line: number) {
  if (value > max) throw new Error(`${label} ${value} exceeds line ${line} length ${max - 1}`)
}

function toPatchLine(line: string, lineEnding: "\n" | "\r\n") {
  if (lineEnding === "\n") return line
  return `${line}\r`
}

function sameLines(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((line, index) => line === right[index])
}
