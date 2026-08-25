import type { AutomationNotification, AutomationRunStatus } from "@lfcode-ai/sdk/v2/client"

export function shouldNotifySessionError(event: { properties: { visible?: boolean } }) {
  return event.properties.visible !== false
}

export function shouldNotifyAutomationRun(run: { status: AutomationRunStatus; notifications: AutomationNotification }) {
  if (run.notifications === "none") return false
  return run.status === "failed" || run.status === "awaiting_user"
}
