export const RENAME_DOUBLE_CLICK_WINDOW_MS = 250

export function isRenameDoubleClick(previousClickAt: number | undefined, currentClickAt: number) {
  if (previousClickAt === undefined) return false
  const elapsed = currentClickAt - previousClickAt
  return elapsed >= 0 && elapsed <= RENAME_DOUBLE_CLICK_WINDOW_MS
}
