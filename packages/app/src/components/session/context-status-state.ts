import type { SessionContextStatus } from "@lfcode-ai/sdk/v2/client"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"

export type ContextStatusRequest = {
  sessionID: string
  directory?: string
  generation: number
}

export function isCurrentContextStatusRequest(request: ContextStatusRequest, generation: number) {
  return request.generation === generation
}

export function contextStatusTone(pressure: SessionContextStatus["pressure"]) {
  if (pressure === "rebuild") return "bg-status-error"
  if (pressure === "checkpoint") return "bg-status-warning"
  if (pressure === "monitoring") return "bg-status-info"
  return "bg-status-success"
}

export function formatContextStatusTokens(value: number, locale: string) {
  void locale
  return formatTokenCount(value)
}
