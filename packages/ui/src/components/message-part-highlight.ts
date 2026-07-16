import type { AgentPart, FilePart } from "@lfcode-ai/sdk/v2"

export type HighlightSegment = { text: string; type?: "file" | "agent" }

export function buildHighlightSegments(text: string, references: FilePart[], agents: AgentPart[]) {
  const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
    ...references
      .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
      .map((r) => ({ start: r.source!.text!.start, end: r.source!.text!.end, type: "file" as const })),
    ...agents
      .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
      .map((a) => ({ start: a.source!.start, end: a.source!.end, type: "agent" as const })),
  ].sort((a, b) => a.start - b.start)

  const result: HighlightSegment[] = []
  let lastIndex = 0

  for (const ref of allRefs) {
    if (ref.start < lastIndex) continue

    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) })
    }

    result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
    lastIndex = ref.end
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) })
  }

  return result
}
