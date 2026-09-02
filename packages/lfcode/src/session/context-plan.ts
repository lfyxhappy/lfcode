import { Token } from "@/util"
import type { MessageID, PartID, SessionID } from "./schema"
import type * as MessageV2 from "./message-v2"

type Message = MessageV2.Info
type Part = MessageV2.Part

export type ContextPlanSnapshot = {
  sessionID: SessionID
  messageRevision: number
  partRevision: number
  sourceRevision: number
  toolRevision: number
  messagesByID: ReadonlyMap<string, Message>
  partsByMessageID: ReadonlyMap<string, ReadonlyMap<string, Part>>
  sourcesByMessageID: ReadonlyMap<string, readonly string[]>
  tokenEstimateByMessageID: ReadonlyMap<string, number>
}

function collectSources(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    if (value.length > 2 && (value.includes("/") || value.startsWith("http://") || value.startsWith("https://") || /\.[a-z0-9]{1,8}$/i.test(value))) output.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, output)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes("path") || key.toLowerCase().includes("source") || key.toLowerCase().includes("uri")) collectSources(child, output)
    else if (typeof child === "object" || typeof child === "string") collectSources(child, output)
  }
}

function estimate(value: unknown) {
  try {
    return Token.estimate(JSON.stringify(value))
  } catch {
    return 0
  }
}

class Plan {
  readonly sessionID: SessionID
  messageRevision = 0
  partRevision = 0
  sourceRevision = 0
  toolRevision = 0
  readonly messagesByID = new Map<string, Message>()
  readonly partsByMessageID = new Map<string, Map<string, Part>>()
  readonly sourcesByMessageID = new Map<string, string[]>()
  readonly tokenEstimateByMessageID = new Map<string, number>()

  constructor(sessionID: SessionID) { this.sessionID = sessionID }

  upsertMessage(message: Message) {
    if (message.sessionID !== this.sessionID) return
    this.messagesByID.set(message.id, message)
    this.messageRevision += 1
    this.recomputeMessage(message.id)
  }

  upsertPart(part: Part) {
    if (part.sessionID !== this.sessionID) return
    const parts = this.partsByMessageID.get(part.messageID) ?? new Map<string, Part>()
    parts.set(part.id, part)
    this.partsByMessageID.set(part.messageID, parts)
    this.partRevision += 1
    this.recomputeMessage(part.messageID)
  }

  applyPartDelta(messageID: MessageID | string, partID: PartID | string, field: string, delta: string) {
    const part = this.partsByMessageID.get(messageID)?.get(partID)
    if (!part) return
    const next = { ...part } as Record<string, unknown>
    next[field] = `${typeof next[field] === "string" ? next[field] : ""}${delta}`
    this.upsertPart(next as Part)
  }

  removeMessage(messageID: MessageID | string) {
    if (!this.messagesByID.delete(messageID)) return
    this.partsByMessageID.delete(messageID)
    this.sourcesByMessageID.delete(messageID)
    this.tokenEstimateByMessageID.delete(messageID)
    this.messageRevision += 1
    this.sourceRevision += 1
  }

  removePart(messageID: MessageID | string, partID: PartID | string) {
    const parts = this.partsByMessageID.get(messageID)
    if (!parts?.delete(partID)) return
    if (parts.size === 0) this.partsByMessageID.delete(messageID)
    this.partRevision += 1
    this.recomputeMessage(messageID)
  }

  markToolRevision() { this.toolRevision += 1 }

  snapshot(): ContextPlanSnapshot {
    return {
      sessionID: this.sessionID,
      messageRevision: this.messageRevision,
      partRevision: this.partRevision,
      sourceRevision: this.sourceRevision,
      toolRevision: this.toolRevision,
      messagesByID: this.messagesByID,
      partsByMessageID: this.partsByMessageID,
      sourcesByMessageID: this.sourcesByMessageID,
      tokenEstimateByMessageID: this.tokenEstimateByMessageID,
    }
  }

  private recomputeMessage(messageID: string) {
    const message = this.messagesByID.get(messageID)
    if (!message) return
    const parts = [...(this.partsByMessageID.get(messageID)?.values() ?? [])]
    const sources = new Set<string>()
    collectSources(message, sources)
    for (const part of parts) collectSources(part, sources)
    const next = [...sources].sort()
    const previous = this.sourcesByMessageID.get(messageID)
    if (!previous || previous.join("\0") !== next.join("\0")) this.sourceRevision += 1
    this.sourcesByMessageID.set(messageID, next)
    this.tokenEstimateByMessageID.set(messageID, estimate({ message, parts }))
  }
}

const plans = new Map<string, Plan>()
export function forSession(sessionID: SessionID) { const existing = plans.get(sessionID); if (existing) return existing; const next = new Plan(sessionID); plans.set(sessionID, next); return next }
export function drop(sessionID: SessionID) { plans.delete(sessionID) }
export function clear() { plans.clear() }
export const ContextPlan = { forSession, drop, clear }
