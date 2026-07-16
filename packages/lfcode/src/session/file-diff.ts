import type { Vcs } from "@/project"
import { isRecord } from "@/util/record"
import type { MessageV2 } from "./message-v2"

export type FileDiff = Vcs.FileDiff

export function compactFileDiffForSummary(input: FileDiff): FileDiff {
  if (input.patch === "") return input
  return { ...input, patch: "" }
}

export function compactFileDiffsForSummary(input: FileDiff[]) {
  return input.map(compactFileDiffForSummary)
}

export function collectMessageFileDiffs(messages: MessageV2.WithParts[]) {
  return messages.flatMap((message) => message.parts.flatMap((part) => collectPartFileDiffs(part)))
}

export function collectMessagePatchTexts(messages: MessageV2.WithParts[]) {
  return messages.flatMap((message) => message.parts.flatMap((part) => collectPartPatchTexts(part)))
}

function collectPartFileDiffs(part: MessageV2.Part): FileDiff[] {
  if (part.type !== "tool" || part.state.status !== "completed") return []
  return collectMetadataFileDiffs(part.state.metadata ?? part.metadata)
}

function collectPartPatchTexts(part: MessageV2.Part): string[] {
  if (part.type !== "tool" || part.state.status !== "completed") return []
  return collectMetadataPatchTexts(part.state.metadata ?? part.metadata)
}

function collectMetadataFileDiffs(metadata: unknown): FileDiff[] {
  if (!isRecord(metadata)) return []

  if (Array.isArray(metadata.results)) {
    return metadata.results.flatMap((item) => collectMetadataFileDiffs(item))
  }

  if (Array.isArray(metadata.files)) {
    return metadata.files.flatMap((item) => normalizeFileDiff(item))
  }

  if (metadata.filediff) {
    return normalizeFileDiff(metadata.filediff)
  }

  return []
}

function collectMetadataPatchTexts(metadata: unknown): string[] {
  if (!isRecord(metadata)) return []

  if (Array.isArray(metadata.results)) {
    return metadata.results.flatMap((item) => collectMetadataPatchTexts(item))
  }

  if (Array.isArray(metadata.files)) {
    return metadata.files.flatMap((item) => (typeof item.patch === "string" ? [item.patch] : []))
  }

  if (typeof metadata.diff === "string") return [metadata.diff]
  if (isRecord(metadata.filediff) && typeof metadata.filediff.patch === "string") return [metadata.filediff.patch]

  return []
}

function normalizeFileDiff(input: unknown): FileDiff[] {
  if (!isRecord(input)) return []
  const file = typeof input.file === "string" ? input.file : typeof input.relativePath === "string" ? input.relativePath : typeof input.filePath === "string" ? input.filePath : undefined
  if (!file) return []
  const patch = typeof input.patch === "string" ? input.patch : ""
  const additions = typeof input.additions === "number" ? input.additions : 0
  const deletions = typeof input.deletions === "number" ? input.deletions : 0
  const status =
    input.status === "added" || input.status === "deleted" || input.status === "modified" ? input.status : undefined
  return [
    {
      file,
      patch,
      additions,
      deletions,
      ...(status ? { status } : {}),
    },
  ]
}
