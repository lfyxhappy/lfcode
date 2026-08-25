import { expect, test } from "bun:test"
import {
  ManagedMcpManifest,
  McpCatalogItem,
  minimaxTokenPlanCatalogItem,
} from "../../src/mcp/catalog"
import {
  MINIMAX_TOKEN_PLAN_MCP_COMMAND,
  MINIMAX_TOKEN_PLAN_MCP_ENVIRONMENT,
  MINIMAX_TOKEN_PLAN_MCP_ID,
  formatMiniMaxTokenPlanError,
  minimaxTokenPlanConfig,
} from "../../src/mcp/minimax-token-plan"

test("MiniMax Token Plan catalog recipe is builtin, dynamic, and credential-safe", () => {
  const item = minimaxTokenPlanCatalogItem()
  expect(McpCatalogItem.parse(item)).toMatchObject({
    id: MINIMAX_TOKEN_PLAN_MCP_ID,
    source: "builtin",
    packageType: "uvx",
    transportType: "stdio",
    installable: true,
    installAdapter: "minimax-token-plan",
  })
  expect(item.description).toContain("web search")
  expect(item.installReason).toContain("seat or credits")

  const config = minimaxTokenPlanConfig()
  expect(config).toEqual({
    type: "local",
    command: [...MINIMAX_TOKEN_PLAN_MCP_COMMAND],
    environment: { ...MINIMAX_TOKEN_PLAN_MCP_ENVIRONMENT },
    enabled: true,
  })
  expect(JSON.stringify(config)).not.toContain("test-key")

  const manifest = ManagedMcpManifest.parse({
    id: MINIMAX_TOKEN_PLAN_MCP_ID,
    serverName: MINIMAX_TOKEN_PLAN_MCP_ID,
    title: "MiniMax Token Plan",
    source: "builtin",
    adapter: "minimax-token-plan",
    installedAt: "2026-07-22T00:00:00.000Z",
    configTarget: "project",
    configName: MINIMAX_TOKEN_PLAN_MCP_ID,
    payload: { kind: "none" },
    upstream: {},
  })
  expect(JSON.stringify(manifest)).not.toContain("MINIMAX_API_KEY")

  expect(formatMiniMaxTokenPlanError(new Error("MINIMAX_API_KEY is missing"))).toContain("MINIMAX_API_KEY")
  expect(formatMiniMaxTokenPlanError(new Error("spawn uvx ENOENT"))).toContain("uvx")
  expect(formatMiniMaxTokenPlanError(new Error("HTTP 403 forbidden"))).toContain("seat or credits")
})
