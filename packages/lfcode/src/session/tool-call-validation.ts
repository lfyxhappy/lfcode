function listAvailableTools(activeTools: ReadonlyArray<string>) {
  return activeTools.length ? activeTools.join(", ") : "(none)"
}

export function describeUnavailableTool(requestedToolName: string, activeTools: ReadonlyArray<string>) {
  return `Tool \"${requestedToolName}\" is not available in this turn. Available tools: ${listAvailableTools(activeTools)}`
}
