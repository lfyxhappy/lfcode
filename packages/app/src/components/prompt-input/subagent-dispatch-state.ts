export function parseSubagentDeclaredFiles(value: string) {
  return [...new Set(value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean))]
}

export function subagentDispatchDescription(task: string) {
  return task.trim().replace(/\s+/g, " ").slice(0, 160)
}
