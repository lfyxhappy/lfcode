import { ConfigMCP } from "@/config/mcp"

export const MINIMAX_TOKEN_PLAN_MCP_ID = "minimax-token-plan"
export const MINIMAX_TOKEN_PLAN_MCP_TITLE = "MiniMax Token Plan"
export const MINIMAX_TOKEN_PLAN_MCP_COMMAND = ["uvx", "minimax-coding-plan-mcp", "-y"] as const
export const MINIMAX_TOKEN_PLAN_MCP_HOST = "https://api.minimaxi.com"
export const MINIMAX_TOKEN_PLAN_MCP_ENVIRONMENT = {
  MINIMAX_API_KEY: "{env:MINIMAX_API_KEY}",
  MINIMAX_API_HOST: MINIMAX_TOKEN_PLAN_MCP_HOST,
} as const
export const MINIMAX_TOKEN_PLAN_MCP_DESCRIPTION =
  "Official MiniMax Token Plan MCP for web search and any additional tools exposed by the installed package."
export const MINIMAX_TOKEN_PLAN_MCP_INSTALL_REASON =
  "Requires uvx and a MiniMax Token Plan seat or credits. Configure MINIMAX_API_KEY before connecting."

export function minimaxTokenPlanConfig() {
  return {
    type: "local" as const,
    command: [...MINIMAX_TOKEN_PLAN_MCP_COMMAND],
    environment: { ...MINIMAX_TOKEN_PLAN_MCP_ENVIRONMENT },
    enabled: true,
  } satisfies ConfigMCP.Info
}

export function hasMiniMaxTokenPlanKey() {
  return Boolean(process.env.MINIMAX_API_KEY?.trim())
}

export function formatMiniMaxTokenPlanError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const key = process.env.MINIMAX_API_KEY
  const message = ConfigMCP.redactString(key ? raw.replaceAll(key, "****") : raw)

  if (/MINIMAX_API_KEY.*(?:missing|not set|empty|required)/i.test(message)) {
    return "MiniMax Token Plan MCP requires MINIMAX_API_KEY. Configure the key before connecting."
  }

  if (/(?:enoent|not found|cannot find|spawn\s+uvx)/i.test(message)) {
    return `MiniMax Token Plan MCP requires uvx. Install uv/uvx and try again. (${message})`
  }

  if (/(?:401|403|unauthori[sz]|forbidden|permission|seat|credit|quota|entitlement)/i.test(message)) {
    return `MiniMax Token Plan access was denied. Check the Token Plan seat or credits. (${message})`
  }

  return `MiniMax Token Plan MCP failed to start: ${message}`
}
