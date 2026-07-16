import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"

export function isSessionTurnWorking(input: {
  status: SessionStatus | undefined
  active?: boolean
  hasPendingAssistant?: boolean
}) {
  const streaming = input.status?.type === "busy" || input.status?.type === "retry"
  if (!streaming) return false
  if (typeof input.active === "boolean") return input.active
  return !!input.hasPendingAssistant
}
