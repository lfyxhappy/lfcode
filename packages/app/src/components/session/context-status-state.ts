import type { SessionContextStatus } from "@lfcode-ai/sdk/v2/client"

export function contextStatusTone(pressure: SessionContextStatus["pressure"]) {
  if (pressure === "rebuild") return "bg-status-error"
  if (pressure === "checkpoint") return "bg-status-warning"
  if (pressure === "monitoring") return "bg-status-info"
  return "bg-status-success"
}

export function formatContextStatusTokens(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}
