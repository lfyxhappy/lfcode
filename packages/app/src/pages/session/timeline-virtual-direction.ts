/** True only when a history window gained turns before its existing first turn. */
export function prependsTimelineTurns(previous: string[], next: string[]) {
  if (previous.length === 0 || next.length <= previous.length) return false
  const offset = next.length - previous.length
  return previous.every((turnID, index) => next[index + offset] === turnID)
}
