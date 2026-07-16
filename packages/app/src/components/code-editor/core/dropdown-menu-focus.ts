export function shouldRestoreMenuTrigger(input: {
  closedWithEscape: boolean
  trigger: HTMLElement | undefined
  activeElement: HTMLElement | undefined
}) {
  if (!input.closedWithEscape || !input.trigger?.isConnected) return false
  return !input.activeElement || input.activeElement === input.trigger
}
