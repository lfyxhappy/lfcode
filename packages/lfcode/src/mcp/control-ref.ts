import type { MCP } from "."

export const mcpControlRef: {
  current: Pick<MCP.Interface, "connect" | "disconnect" | "status"> | undefined
} = { current: undefined }
