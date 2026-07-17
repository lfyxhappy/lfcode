import z from "zod"
import { Effect } from "effect"
import { Config } from "@/config"
import { ConfigMCP } from "@/config/mcp"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { mcpControlRef } from "@/mcp/control-ref"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "save", "remove", "enable", "disable", "connect", "disconnect", "test"]),
  name: z.string().min(1).optional(),
  config: ConfigMCP.Info.zod.optional(),
  target: z.enum(["project", "global"]).optional(),
  reason: z.string().min(1).describe("Short reason for this MCP management action."),
})

export const McpManageTool = Tool.define(
  "mcp_manage",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: "List, add, update, enable, disable, connect, disconnect, test, or remove MCP configuration. Secrets are never returned in the tool result or audit trail.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action !== "list" && !params.name) throw new Error(`mcp_manage ${params.action} requires name`)
          if (params.action === "save" && !params.config) throw new Error("mcp_manage save requires config")
          const gate = decideCapabilityOperation({
            caller: "tool:mcp_manage",
            capability: "mcp_manage",
            risk:
              params.action === "list"
                ? "read"
                : params.action === "remove"
                  ? "destructive"
                  : params.action === "save"
                    ? "install"
                    : "modify",
            source: "mcp",
            operation:
              params.action === "list"
                ? "read"
                : params.action === "remove"
                  ? "delete"
                  : params.action === "save"
                    ? "install"
                    : params.action === "connect" || params.action === "disconnect" || params.action === "test"
                      ? "execute"
                    : params.action,
            previewed: true,
            reversible: params.action !== "remove",
            target: params.name,
            sessionID: ctx.sessionID,
            reason: params.reason,
          })
          requireCapabilityDecision(gate.decision)
          if (gate.decision === "confirm") {
            yield* ctx.ask({
              permission: "edit",
              patterns: [`mcp:${params.action}:${params.name ?? "managed"}`],
              always: [],
              metadata: { mcp_action: params.action, mcp_name: params.name },
            })
          }
          if (params.action === "list") {
            const current = yield* config.get()
            const entries = Object.entries(current.mcp ?? {}).map(([name, item]) => ({
              name,
              type: item.type,
              enabled: item.enabled ?? true,
            }))
            completeCapabilityOperation(gate.auditID, `completed (${entries.length} MCP servers)`)
            return result(params.reason, entries)
          }
          if (params.action === "remove") {
            yield* config.removeMcp(params.name!)
            completeCapabilityOperation(gate.auditID, "completed")
            return result(params.reason, { removed: params.name })
          }
          if (params.action === "enable" || params.action === "disable") {
            yield* config.updateMcpEnabled(params.name!, params.action === "enable")
            completeCapabilityOperation(gate.auditID, "completed", {
              action: params.action === "enable" ? "disable" : "enable",
              name: params.name,
            })
            return result(params.reason, { name: params.name, enabled: params.action === "enable" })
          }
          if (params.action === "connect" || params.action === "disconnect" || params.action === "test") {
            const mcp = requireMcpControl()
            if (params.action === "disconnect") {
              yield* mcp.disconnect(params.name!)
              completeCapabilityOperation(gate.auditID, "completed")
              return result(params.reason, { name: params.name, connected: false })
            }
            yield* mcp.connect(params.name!)
            const status = yield* mcp.status()
            completeCapabilityOperation(gate.auditID, "completed")
            return result(params.reason, { name: params.name, connected: true, status: status[params.name!] })
          }
          yield* config.upsertMcp(params.name!, params.config!, { target: params.target ?? "auto" })
          completeCapabilityOperation(gate.auditID, "completed", { action: "remove", name: params.name })
          return result(params.reason, { saved: params.name, target: params.target ?? "auto" })
        }).pipe(Effect.orDie),
    }
  }),
)

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}

function requireMcpControl() {
  if (!mcpControlRef.current) throw new Error("MCP runtime is not initialized")
  return mcpControlRef.current
}
