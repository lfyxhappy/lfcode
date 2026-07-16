export type SessionViewportStateV3 =
  | {
      version: 3
      mode: "bottom"
      assistantRevision: string
      historyTurnStart: number
      updatedAt: number
    }
  | {
      version: 3
      mode: "anchor"
      assistantRevision: string
      historyTurnStart: number
      anchorBlockId: string
      anchorTurnId: string
      anchorOffsetPx: number
      updatedAt: number
    }

export type TimelineViewportSnapshot = SessionViewportStateV3

export function createTimelineViewportSnapshot(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  anchorBlockId?: string
  anchorTurnId?: string
  anchorTop?: number
  viewportTop?: number
  assistantRevision: string
  historyTurnStart: number
  now?: number
}) {
  const max = input.scrollHeight - input.clientHeight
  const distance = max - input.scrollTop
  const updatedAt = input.now ?? Date.now()
  const historyTurnStart = Math.max(0, Math.trunc(input.historyTurnStart))
  if (max <= 1 || distance <= 2) {
    return {
      version: 3,
      mode: "bottom",
      assistantRevision: input.assistantRevision,
      historyTurnStart,
      updatedAt,
    } satisfies TimelineViewportSnapshot
  }
  if (!input.anchorBlockId) return
  if (input.anchorTop === undefined || input.viewportTop === undefined) return
  const anchorOffsetPx = input.anchorTop - input.viewportTop
  if (!Number.isFinite(anchorOffsetPx)) return
  return {
    version: 3,
    mode: "anchor",
    assistantRevision: input.assistantRevision,
    historyTurnStart,
    anchorBlockId: input.anchorBlockId,
    anchorTurnId: input.anchorTurnId ?? input.anchorBlockId,
    anchorOffsetPx,
    updatedAt,
  } satisfies TimelineViewportSnapshot
}

export function createAssistantActivityRevision(input: {
  assistantMessageId?: string
  streaming: boolean
}) {
  return `${input.assistantMessageId ?? ""}\n${input.streaming ? "streaming" : "idle"}`
}

export function shouldRestoreViewportSnapshot(input: {
  snapshot: SessionViewportStateV3 | undefined
  assistantRevision: string
  streaming: boolean
}) {
  if (!input.snapshot) return false
  if (input.streaming) return false
  return input.snapshot.assistantRevision === input.assistantRevision
}

export function getAnchorRestoreTop(input: {
  currentScrollTop: number
  currentAnchorTop: number
  viewportTop: number
  anchorOffsetPx: number
}) {
  const nextOffset = input.currentAnchorTop - input.viewportTop
  return Math.max(0, input.currentScrollTop + nextOffset - input.anchorOffsetPx)
}

export function isBottomRestoreSettled(input: {
  messageCount: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  stableFrames: number
}) {
  const maxTop = Math.max(0, input.scrollHeight - input.clientHeight)
  return input.messageCount > 0 && Math.abs(input.scrollTop - maxTop) <= 1 && input.stableFrames >= 2
}
