import type { SnapshotFileDiff, VcsFileDiff } from "@lfcode-ai/sdk/v2"
import type { Message } from "@lfcode-ai/sdk/v2/client"

type Diff = SnapshotFileDiff | VcsFileDiff

function diff(value: unknown): value is Diff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("patch" in value) || typeof value.patch !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if (!("status" in value) || value.status === undefined) return true
  return value.status === "added" || value.status === "deleted" || value.status === "modified"
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function diffs(value: unknown): Diff[] {
  if (Array.isArray(value) && value.every(diff)) return merge(value)
  if (Array.isArray(value)) return merge(value.filter(diff))
  if (diff(value)) return merge([value])
  if (!object(value)) return []
  return merge(Object.values(value).filter(diff))
}

export function message(value: Message): Message {
  if (value.role !== "user") return value

  const raw = value.summary as unknown
  if (raw === undefined) return value
  if (!object(raw)) return { ...value, summary: undefined }

  const title = typeof raw.title === "string" ? raw.title : undefined
  const body = typeof raw.body === "string" ? raw.body : undefined
  const next = diffs(raw.diffs)

  if (title === raw.title && body === raw.body && next === raw.diffs) return value

  return {
    ...value,
    summary: {
      ...(title === undefined ? {} : { title }),
      ...(body === undefined ? {} : { body }),
      diffs: next,
    },
  }
}

function merge(input: Diff[]) {
  const out = new Map<string, Diff>()

  for (const raw of input) {
    const item = raw.patch === "" ? raw : { ...raw, patch: "" }
    const prev = out.get(item.file)
    if (!prev) {
      out.set(item.file, item)
      continue
    }

    out.set(item.file, {
      ...item,
      patch: "",
      additions: prev.additions + item.additions,
      deletions: prev.deletions + item.deletions,
      ...(mergeStatus(prev, item) ? { status: mergeStatus(prev, item) } : {}),
    })
  }

  return [...out.values()]
}

function mergeStatus(prev: Diff, next: Diff): Diff["status"] {
  const statuses = [prev.status, next.status].filter((item) => !!item)
  if (statuses.length === 0) return undefined
  if (statuses.includes("added") && !statuses.includes("deleted")) return "added"
  if (statuses.includes("deleted") && !statuses.includes("added")) return "deleted"
  return "modified"
}
