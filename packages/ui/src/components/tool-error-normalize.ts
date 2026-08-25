export function normalizeToolError(tool: string, error: string) {
  if (tool === "invalid") return error
  if (!/unavailable tool ['\"]invalid['\"]/i.test(error)) return error
  return `工具 ${tool} 的参数不完整，无法解析。请重新生成有效的工具参数。`
}
