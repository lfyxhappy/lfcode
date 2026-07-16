export function promptHistoryCursor(position: "start" | "end", textLength: number) {
  return position === "start" ? 0 : textLength
}

export function shouldResetPromptHistoryNavigation(input: {
  force?: boolean
  historyIndex: number
  applyingHistory: boolean
}) {
  if (input.force) return true
  if (input.historyIndex < 0) return false
  if (input.applyingHistory) return false
  return true
}
