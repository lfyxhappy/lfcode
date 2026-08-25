import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs"
import { formatPatch, parsePatch, structuredPatch } from "diff"
import type { SnapshotFileDiff, VcsFileDiff } from "@lfcode-ai/sdk/v2"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff | LegacyDiff

export type ViewDiff = {
  file: string
  patch: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

function patch(diff: ReviewDiff) {
  if (typeof diff.patch === "string") {
    const content = patchContent(diff.patch)
    return { ...content, patch: diff.patch }
  }
  return {
    before: "before" in diff && typeof diff.before === "string" ? diff.before : "",
    after: "after" in diff && typeof diff.after === "string" ? diff.after : "",
    patch: formatPatch(
      structuredPatch(
        diff.file,
        diff.file,
        "before" in diff && typeof diff.before === "string" ? diff.before : "",
        "after" in diff && typeof diff.after === "string" ? diff.after : "",
        "",
        "",
        { context: Number.MAX_SAFE_INTEGER },
      ),
    ),
  }
}

function patchContent(value: string) {
  try {
    const parsed = parsePatch(value)[0]
    if (parsed?.hunks.length) return hunkContent(parsed.hunks.flatMap((hunk) => hunk.lines), value)
  } catch {
    // Some persisted tool records contain incomplete unified-diff headers. Recover their hunk body below.
  }

  const lines = value.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith("@@"))
  if (start === -1) return { before: "", after: "" }
  return hunkContent(lines.slice(start + 1), value)
}

function hunkContent(lines: string[], source: string) {
  const before = [] as string[]
  const after = [] as string[]

  for (const line of lines) {
    if (line.startsWith("@@")) continue
    if (line.startsWith("\\ No newline at end of file")) continue
    if (line.startsWith("-")) {
      before.push(line.slice(1))
      continue
    }
    if (line.startsWith("+")) {
      after.push(line.slice(1))
      continue
    }
    if (line.startsWith(" ")) {
      before.push(line.slice(1))
      after.push(line.slice(1))
    }
  }

  const trailingNewline = source.endsWith("\n") && !source.includes("\\ No newline at end of file") ? "\n" : ""
  return {
    before: before.length ? before.join("\n") + trailingNewline : "",
    after: after.length ? after.join("\n") + trailingNewline : "",
  }
}

function file(file: string, patch: string, before: string, after: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  cache.set(patch, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const next = patch(diff)
  return {
    file: diff.file,
    patch: next.patch,
    before: next.before,
    after: next.after,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: file(diff.file, next.patch, next.before, next.after),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.before
  return diff.after
}
