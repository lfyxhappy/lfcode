import type { SessionViewportStateV3 } from "./scroll-snapshot"

export type SessionSurface = "main" | "side-chat"

export type SessionViewportStateV4 =
  | {
      version: 4
      mode: "bottom"
      assistantRevision: string
      historyTurnStart: number
      updatedAt: number
    }
  | {
      version: 4
      mode: "anchor"
      assistantRevision: string
      historyTurnStart: number
      anchorRenderBlockID: string
      anchorTurnID: string
      offsetPx: number
      updatedAt: number
    }

export type SessionViewStateV4 = {
  version: 4
  viewport: SessionViewportStateV4
  history: {
    turnStart: number
    cursor?: string
  }
  expanded?: string[]
  updatedAt: number
}

export function sessionViewSurfaceKey(sessionKey: string, surface: SessionSurface) {
  return `${sessionKey}/${surface}`
}

export function createSessionViewStateV4(input: {
  viewport: SessionViewportStateV4
  turnStart: number
  cursor?: string
  expanded?: string[]
  now?: number
}) {
  return {
    version: 4,
    viewport: input.viewport,
    history: {
      turnStart: Math.max(0, Math.trunc(input.turnStart)),
      cursor: input.cursor,
    },
    expanded: input.expanded?.filter(Boolean),
    updatedAt: input.now ?? Date.now(),
  } satisfies SessionViewStateV4
}

export function createSessionViewportStateV4(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  assistantRevision: string
  historyTurnStart: number
  anchorRenderBlockID?: string
  anchorTurnID?: string
  anchorTop?: number
  viewportTop?: number
  now?: number
}): SessionViewportStateV4 | undefined {
  const max = Math.max(0, input.scrollHeight - input.clientHeight)
  const updatedAt = input.now ?? Date.now()
  const historyTurnStart = Math.max(0, Math.trunc(input.historyTurnStart))
  if (max <= 1 || max - input.scrollTop <= 2) {
    return {
      version: 4,
      mode: "bottom",
      assistantRevision: input.assistantRevision,
      historyTurnStart,
      updatedAt,
    }
  }
  if (!input.anchorRenderBlockID || !input.anchorTurnID) return
  if (input.anchorTop === undefined || input.viewportTop === undefined) return
  const offsetPx = input.anchorTop - input.viewportTop
  if (!Number.isFinite(offsetPx)) return
  return {
    version: 4,
    mode: "anchor",
    assistantRevision: input.assistantRevision,
    historyTurnStart,
    anchorRenderBlockID: input.anchorRenderBlockID,
    anchorTurnID: input.anchorTurnID,
    offsetPx,
    updatedAt,
  }
}

export function shouldRestoreSessionViewState(input: {
  state: SessionViewStateV4 | undefined
  assistantRevision: string
  streaming: boolean
}) {
  if (!input.state || input.streaming) return false
  return input.state.viewport.assistantRevision === input.assistantRevision
}

export function migrateViewportStateV3(value: SessionViewportStateV3 | undefined): SessionViewStateV4 | undefined {
  if (!value) return
  const viewport =
    value.mode === "bottom"
      ? {
          version: 4 as const,
          mode: "bottom" as const,
          assistantRevision: value.assistantRevision,
          historyTurnStart: value.historyTurnStart,
          updatedAt: value.updatedAt,
        }
      : {
          version: 4 as const,
          mode: "anchor" as const,
          assistantRevision: value.assistantRevision,
          historyTurnStart: value.historyTurnStart,
          anchorRenderBlockID: value.anchorBlockId,
          anchorTurnID: value.anchorTurnId,
          offsetPx: value.anchorOffsetPx,
          updatedAt: value.updatedAt,
        }
  return createSessionViewStateV4({
    viewport,
    turnStart: value.historyTurnStart,
    now: value.updatedAt,
  })
}

export function normalizeSessionViewStateV4(value: unknown): SessionViewStateV4 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const input = value as Record<string, unknown>
  if (input.version !== 4 || !input.viewport || typeof input.viewport !== "object" || Array.isArray(input.viewport)) return
  if (!input.history || typeof input.history !== "object" || Array.isArray(input.history)) return
  if (typeof input.updatedAt !== "number" || !Number.isFinite(input.updatedAt)) return

  const viewport = input.viewport as Record<string, unknown>
  const history = input.history as Record<string, unknown>
  if (typeof viewport.assistantRevision !== "string") return
  if (typeof viewport.historyTurnStart !== "number" || !Number.isFinite(viewport.historyTurnStart)) return
  if (typeof viewport.updatedAt !== "number" || !Number.isFinite(viewport.updatedAt)) return
  if (typeof history.turnStart !== "number" || !Number.isFinite(history.turnStart)) return

  const shared = {
    version: 4 as const,
    assistantRevision: viewport.assistantRevision,
    historyTurnStart: Math.max(0, Math.trunc(viewport.historyTurnStart)),
    updatedAt: viewport.updatedAt,
  }
  const nextViewport =
    viewport.mode === "bottom"
      ? { ...shared, mode: "bottom" as const }
      : viewport.mode === "anchor" &&
          typeof viewport.anchorRenderBlockID === "string" &&
          typeof viewport.anchorTurnID === "string" &&
          typeof viewport.offsetPx === "number" &&
          Number.isFinite(viewport.offsetPx)
        ? {
            ...shared,
            mode: "anchor" as const,
            anchorRenderBlockID: viewport.anchorRenderBlockID,
            anchorTurnID: viewport.anchorTurnID,
            offsetPx: viewport.offsetPx,
          }
        : undefined
  if (!nextViewport) return

  return createSessionViewStateV4({
    viewport: nextViewport,
    turnStart: history.turnStart,
    cursor: typeof history.cursor === "string" ? history.cursor : undefined,
    expanded: Array.isArray(input.expanded) ? input.expanded.filter((item): item is string => typeof item === "string") : undefined,
    now: input.updatedAt,
  })
}

type RevisionEntry = {
  signature: string
  revision: number
}

const revisions = new Map<string, RevisionEntry>()

/** Tracks every visible message, part, tool, and stream-status transition without storing message content. */
export function sessionContentRevision(key: string, signature: string) {
  const current = revisions.get(key)
  if (current?.signature === signature) return current.revision
  const next = (current?.revision ?? 0) + 1
  revisions.set(key, { signature, revision: next })
  return next
}

export function resetSessionContentRevision(key: string) {
  revisions.delete(key)
}

type ContentRevisionMessage = {
  id: string
  role: string
  parentID?: string
  time?: { created?: number }
}

type ContentRevisionPart = {
  id: string
  type: string
  text?: string
  content?: string
  state?: unknown
}

/**
 * Tracks the active tail without serializing message or tool output. A tail
 * part changing is enough to invalidate a cached view, while its compact
 * shape keeps streaming updates independent from response size.
 */
export function createSessionContentSignature(input: {
  status: string
  updatedAt?: number
  messageCount?: number
  tailMessage?: ContentRevisionMessage
  tailParts?: readonly ContentRevisionPart[]
}) {
  const message = input.tailMessage
  const tail = message
    ? `${message.id}:${message.role}:${message.parentID ?? ""}:${Math.max(0, Math.trunc(message.time?.created ?? 0))}`
    : ""
  const parts = input.tailParts?.map(partRevision).join("|") ?? ""
  return [
    input.status,
    Math.max(0, Math.trunc(input.updatedAt ?? 0)),
    Math.max(0, Math.trunc(input.messageCount ?? 0)),
    tail,
    parts,
  ].join(":")
}

function partRevision(part: ContentRevisionPart) {
  const state = record(part.state)
  return [
    part.id,
    part.type,
    part.text?.length ?? 0,
    part.content?.length ?? 0,
    typeof state?.status === "string" ? state.status : "",
    valueSize(state?.input),
    valueSize(state?.output),
  ].join(".")
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function valueSize(value: unknown) {
  if (typeof value === "string") return value.length
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") return Object.keys(value).length
  if (value === undefined || value === null) return 0
  return String(value).length
}
