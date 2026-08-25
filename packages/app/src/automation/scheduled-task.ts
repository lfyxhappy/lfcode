import type { AutomationTarget, AutomationTask } from "@lfcode-ai/sdk/v2/client"

export const SCHEDULED_AUTOMATION_CREATE_EVENT = "lfcode:scheduled-automation-create"

export type ScheduledAutomationCreateRequest = {
  target?: AutomationTarget
  sourceSessionID?: string
  message?: string
  name?: string
  task?: AutomationTask
  onSaved?: () => void
}

export function requestScheduledAutomation(input: ScheduledAutomationCreateRequest) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<ScheduledAutomationCreateRequest>(SCHEDULED_AUTOMATION_CREATE_EVENT, {
      detail: input,
    }),
  )
}
