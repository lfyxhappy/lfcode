import type { Message as MessageType, Part, UserMessage } from "@lfcode-ai/sdk/v2"

type BoundaryKind = "checkpoint" | "compaction"
type Boundary = {
  messageID: string
  kind: BoundaryKind
  valid: boolean
  reason?: string
}

export type MessageTimelineCompactionState = "idle" | "compacting" | "compacted" | "failed"

export type MessageTimelineContextView = {
  fullHistory: MessageType[]
  activeContext: MessageType[]
  renderedHistory: UserMessage[]
  renderedActiveContext: UserMessage[]
  compactionState: MessageTimelineCompactionState
  activeContextBoundary?: {
    messageID: string
    kind: BoundaryKind
  }
}

function partsFor(partsByMessageID: Record<string, Part[] | undefined>, messageID: string) {
  return partsByMessageID[messageID] ?? []
}

function hasVisibleText(parts: Part[]) {
  return parts.some((part) => part.type === "text" && !!part.text.trim())
}

function hasCheckpointBody(parts: Part[]) {
  const checkpointIndex = parts.findIndex((part) => part.type === "checkpoint")
  if (checkpointIndex < 0) return false
  return parts.slice(checkpointIndex + 1).some((part) => part.type === "text" && !!part.text.trim())
}

function readBoundaryKind(parts: Part[]) {
  if (parts.some((part) => part.type === "checkpoint")) return "checkpoint" satisfies BoundaryKind
  if (parts.some((part) => part.type === "compaction")) return "compaction" satisfies BoundaryKind
}

function analyzeTimelineContext(input: {
  messages: MessageType[]
  partsByMessageID: Record<string, Part[] | undefined>
  sessionCompacting?: number
}) {
  let latestInvalidBoundary: Boundary | undefined
  let selectedBoundary:
    | {
        index: number
        messageID: string
        kind: BoundaryKind
      }
    | undefined
  let compactionState: MessageTimelineCompactionState | undefined
  let sawAssistantAfter = false
  let sawVisibleAssistantAfter = false

  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]
    if (!message) continue

    if (message.role === "assistant") {
      sawAssistantAfter = true
      if (hasVisibleText(partsFor(input.partsByMessageID, message.id))) sawVisibleAssistantAfter = true
      continue
    }
    if (message.role !== "user") continue

    const parts = partsFor(input.partsByMessageID, message.id)
    const boundaryKind = readBoundaryKind(parts)

    if (boundaryKind === "compaction" && !compactionState) {
      if (sawVisibleAssistantAfter) {
        compactionState = "compacted"
      } else if (typeof input.sessionCompacting === "number") {
        compactionState = "compacting"
      } else if (sawAssistantAfter) {
        compactionState = "failed"
      } else {
        compactionState = "idle"
      }
    }

    if (!boundaryKind || selectedBoundary) continue

    if (boundaryKind === "checkpoint") {
      if (hasCheckpointBody(parts)) {
        selectedBoundary = {
          index: i,
          messageID: message.id,
          kind: boundaryKind,
        }
        continue
      }

      latestInvalidBoundary ??= {
        messageID: message.id,
        kind: boundaryKind,
        valid: false,
        reason: "missing checkpoint rebuild body",
      }
      continue
    }

    if (sawVisibleAssistantAfter) {
      selectedBoundary = {
        index: i,
        messageID: message.id,
        kind: boundaryKind,
      }
      continue
    }

    latestInvalidBoundary ??= {
      messageID: message.id,
      kind: boundaryKind,
      valid: false,
      reason: "missing summary assistant after compaction boundary",
    }
  }

  return {
    activeContext: input.messages.slice(selectedBoundary?.index ?? 0),
    boundary: selectedBoundary
      ? ({
          messageID: selectedBoundary.messageID,
          kind: selectedBoundary.kind,
          valid: true,
        } satisfies Boundary)
      : latestInvalidBoundary,
    compactionState: compactionState ?? ("idle" satisfies MessageTimelineCompactionState),
  }
}

export function buildMessageTimelineContext(input: {
  messages: MessageType[]
  renderedUsers: UserMessage[]
  partsByMessageID: Record<string, Part[] | undefined>
  sessionCompacting?: number
}): MessageTimelineContextView {
  const fullHistory = input.messages
  const analyzed = analyzeTimelineContext({
    messages: fullHistory,
    partsByMessageID: input.partsByMessageID,
    sessionCompacting: input.sessionCompacting,
  })
  const activeIDs = new Set(analyzed.activeContext.map((message) => message.id))

  return {
    fullHistory,
    activeContext: analyzed.activeContext,
    renderedHistory: input.renderedUsers,
    renderedActiveContext: input.renderedUsers.filter((message) => activeIDs.has(message.id)),
    compactionState: analyzed.compactionState,
    activeContextBoundary: analyzed.boundary?.valid
      ? {
          messageID: analyzed.boundary.messageID,
          kind: analyzed.boundary.kind,
        }
      : undefined,
  }
}
