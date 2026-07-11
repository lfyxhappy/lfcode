import { acquireSessionCacheLease } from "@/context/session-cache-lease"

type Entry = {
  template: HTMLDivElement
  revision: string
  turns: string
  scrollLeft: number
  scrollTop: number
  usedAt: number
  releaseLease: () => void
}

const MAX_SNAPSHOTS = 8
const snapshots = new Map<string, Entry>()
let hits = 0
let misses = 0

function turnSignature(turnIDs: string[]) {
  return turnIDs.join("\u0000")
}

/**
 * Retains a bounded, inert copy of a virtual timeline viewport for the current
 * renderer lifetime. It is a visual handoff only: semantic state and virtual
 * measurements remain the restore source of truth.
 */
export function rememberSessionTimelineVisualSnapshot(input: {
  key: string
  sessionID: string
  revision: string
  turnIDs: string[]
  root: HTMLDivElement
}) {
  dropSessionTimelineVisualSnapshot(input.key)
  const template = input.root.cloneNode(true) as HTMLDivElement
  template.removeAttribute("id")
  for (const element of template.querySelectorAll<HTMLElement>("[id]")) element.removeAttribute("id")
  template.setAttribute("aria-hidden", "true")
  template.setAttribute("inert", "")
  template.style.position = "absolute"
  template.style.inset = "0"
  template.style.width = "100%"
  template.style.height = "100%"
  template.style.overflow = "hidden"
  template.style.pointerEvents = "none"
  snapshots.set(input.key, {
    template,
    revision: input.revision,
    turns: turnSignature(input.turnIDs),
    scrollLeft: input.root.scrollLeft,
    scrollTop: input.root.scrollTop,
    usedAt: Date.now(),
    releaseLease: acquireSessionCacheLease({ sessionID: input.sessionID, owner: `visual:${input.key}` }),
  })
  trim()
}

export function readSessionTimelineVisualSnapshot(input: { key: string; revision: string }) {
  const entry = snapshots.get(input.key)
  if (!entry || entry.revision !== input.revision) {
    misses += 1
    return
  }
  hits += 1
  entry.usedAt = Date.now()
  return {
    root: entry.template.cloneNode(true) as HTMLDivElement,
    scrollLeft: entry.scrollLeft,
    scrollTop: entry.scrollTop,
  }
}

export function dropSessionTimelineVisualSnapshot(key: string) {
  snapshots.get(key)?.releaseLease()
  snapshots.delete(key)
}

export function clearSessionTimelineVisualSnapshots() {
  for (const key of snapshots.keys()) dropSessionTimelineVisualSnapshot(key)
  hits = 0
  misses = 0
}

export function coolSessionTimelineVisualSnapshots(input?: { max?: number }) {
  const max = input?.max ?? 0
  if (snapshots.size <= max) return
  const expired = [...snapshots.entries()]
    .sort(([, left], [, right]) => left.usedAt - right.usedAt)
    .slice(0, Math.max(0, snapshots.size - max))
  for (const [key] of expired) dropSessionTimelineVisualSnapshot(key)
}

export function sessionTimelineVisualSnapshotDiagnostics() {
  return {
    hits,
    misses,
    entries: [...snapshots.entries()].map(([key, entry]) => ({
      key,
      revision: entry.revision,
      turns: entry.turns ? entry.turns.split("\u0000").length : 0,
      usedAt: entry.usedAt,
    })),
  }
}

function trim() {
  if (snapshots.size <= MAX_SNAPSHOTS) return
  const oldest = [...snapshots.entries()].sort(([, left], [, right]) => left.usedAt - right.usedAt)[0]?.[0]
  if (oldest) dropSessionTimelineVisualSnapshot(oldest)
}
