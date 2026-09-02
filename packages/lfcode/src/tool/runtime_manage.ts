import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import DESCRIPTION from "./runtime_manage.txt"
import {
  getRuntimeManageState,
  installRuntime,
  listRuntimeOperationLogs,
  repairRuntime,
  updateRuntime,
  type RuntimeManageMutationResult,
  RuntimeManageItemID,
} from "@/runtime-registry"

const Parameters = z.object({
  action: z.enum(["list", "install", "repair", "update", "logs"]).describe("The runtime-management action to perform."),
  id: RuntimeManageItemID.optional().describe("Runtime item ID for install, repair, update, or filtered logs."),
  limit: z.number().optional().describe("Optional number of log entries to return for logs. Defaults to 20."),
  description: z.string().min(1).optional().describe("Required for install, repair, and update; optional for read-only list and logs."),
})

export const RuntimeManageTool = Tool.define<typeof Parameters, Tool.Metadata, never>(
  "runtime_manage",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if ((params.action === "install" || params.action === "repair" || params.action === "update") && !params.id) {
          throw new Error(`runtime_manage action '${params.action}' requires an id.`)
        }
        if ((params.action === "install" || params.action === "repair" || params.action === "update") && !params.description) {
          throw new Error(`runtime_manage action '${params.action}' requires description.`)
        }

        const gate =
          params.action === "install" || params.action === "repair" || params.action === "update"
            ? decideCapabilityOperation({
                caller: "tool:runtime_manage",
                capability: "runtime_manage",
                risk: params.action === "repair" ? "modify" : "install",
                source: "core",
                operation: params.action === "install" ? "install" : "update",
                previewed: true,
                reversible: false,
                target: `runtime:${params.id}`,
                reason: params.description!,
                metadata: { runtimeAction: params.action, runtimeID: params.id },
              })
            : undefined

        if (params.action === "install" || params.action === "repair" || params.action === "update") {
          requireCapabilityDecision(gate!.decision)
          if (gate!.decision === "confirm") {
            yield* ctx.ask({
              permission: "shell",
              patterns: [`runtime:${params.action}:${params.id}`],
              always: ["*"],
              metadata: {
                command: `runtime ${params.action} ${params.id}`,
                runtime_action: params.action,
                runtime_id: params.id!,
              },
            })
          }
        }

        if (params.action === "list") {
          const state = yield* Effect.promise(() => getRuntimeManageState())
          return {
            title: params.description ?? "List runtime status",
            output: renderListOutput(state, params.id),
            metadata: {
              action: params.action,
              id: params.id,
              refreshedAt: state.refreshedAt,
              count: state.items.length,
            },
          }
        }

        if (params.action === "logs") {
          const state = yield* Effect.promise(() =>
            listRuntimeOperationLogs({
              id: params.id,
              limit: params.limit,
            }),
          )
          return {
            title: params.description ?? "Read runtime logs",
            output: renderLogsOutput(state),
            metadata: {
              action: params.action,
              id: params.id,
              refreshedAt: state.refreshedAt,
              count: state.entries.length,
            },
          }
        }

        const result = yield* (params.action === "install"
          ? installRuntime(params.id!)
          : params.action === "repair"
            ? repairRuntime(params.id!)
            : updateRuntime(params.id!))
        completeCapabilityOperation(gate!.auditID, "completed")

        return {
          title: params.description!,
          output: renderMutationOutput(params.action, params.id!, result),
          metadata: {
            action: params.action,
            id: params.id!,
            refreshedAt: result.state.refreshedAt,
            count: result.state.items.length,
          },
        }
      }).pipe(Effect.orDie),
  }),
)

function renderListOutput(
  state: Awaited<ReturnType<typeof getRuntimeManageState>>,
  id: z.infer<typeof RuntimeManageItemID> | undefined,
) {
  const items = id ? state.items.filter((item) => item.id === id) : state.items
  if (items.length === 0) return "No runtime items matched the request."
  return items
    .map((item) =>
      [
        `${item.title} (${item.id})`,
        `- installed: ${item.installed ? "yes" : "no"}`,
        `- source: ${item.source}`,
        `- version: ${item.version ?? "unknown"}`,
        `- scope: ${item.scope}`,
        `- usedBy: ${item.usedBy.join(", ")}`,
        `- path: ${item.path ?? "n/a"}`,
        `- actions: install=${item.actions.install}, repair=${item.actions.repair}, logs=${item.actions.viewLogs}`,
        item.detail ? `- detail: ${item.detail}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

function renderLogsOutput(state: Awaited<ReturnType<typeof listRuntimeOperationLogs>>) {
  if (state.entries.length === 0) return "No runtime operation logs were found."
  return state.entries
    .map((entry) =>
      [
        `${new Date(entry.timestamp).toISOString()} ${entry.title}`,
        `- id: ${entry.id}`,
        `- action: ${entry.action}`,
        `- status: ${entry.status}`,
        entry.sourceLabel ? `- source: ${entry.sourceLabel}` : undefined,
        `- message: ${entry.message}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

function renderMutationOutput(
  action: "install" | "repair" | "update",
  id: z.infer<typeof RuntimeManageItemID>,
  result: RuntimeManageMutationResult,
) {
  const item = result.state.items.find((entry) => entry.id === id)
  return [
    result.message,
    item
      ? [
          "",
          `${item.title} (${item.id})`,
          `- installed: ${item.installed ? "yes" : "no"}`,
          `- source: ${item.source}`,
          `- version: ${item.version ?? "unknown"}`,
          `- path: ${item.path ?? "n/a"}`,
          item.detail ? `- detail: ${item.detail}` : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      : `\nNo refreshed runtime item was found for ${id} after ${action}.`,
  ].join("\n")
}
