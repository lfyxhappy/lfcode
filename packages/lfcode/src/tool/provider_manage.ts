import z from "zod"
import { Effect } from "effect"
import { generateText } from "ai"
import { Config } from "@/config"
import { ConfigProvider } from "@/config/provider"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "save_custom", "remove_custom", "enable", "disable", "set_route", "test"]),
  provider_id: z.string().min(1).optional(),
  model_id: z.string().min(1).optional(),
  route: z.enum(["primary", "cheap", "review", "background"]).optional(),
  config: ConfigProvider.Info.zod.optional(),
  api_key: z.string().min(1).optional().describe("API key to store in the credential vault. It is never returned or audited."),
  reason: z.string().min(1).describe("Short reason for this Provider management action."),
})

export const ProviderManageTool = Tool.define(
  "provider_manage",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    return {
      description:
        "List, add, update, remove, or live-test managed custom AI providers. API keys are stored separately and never returned in tool output or audit records.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!["list", "set_route"].includes(params.action) && !params.provider_id) {
            throw new Error(`provider_manage ${params.action} requires provider_id`)
          }
          if (params.action === "save_custom" && !params.config) {
            throw new Error("provider_manage save_custom requires config")
          }
          if (params.action === "test" && !params.model_id) {
            throw new Error("provider_manage test requires model_id")
          }
          if (params.action === "set_route" && (!params.provider_id || !params.model_id || !params.route)) {
            throw new Error("provider_manage set_route requires provider_id, model_id, and route")
          }

          const gate = decideCapabilityOperation({
            caller: "tool:provider_manage",
            capability: "provider_manage",
            risk:
              params.action === "list"
                ? "read"
                : params.action === "remove_custom"
                  ? "destructive"
                  : params.action === "test" || params.api_key
                    ? "credential"
                    : "modify",
            source: "core",
            operation:
              params.action === "list"
                ? "read"
                : params.action === "remove_custom"
                  ? "delete"
                  : params.action === "save_custom"
                    ? "update"
                    : params.action === "enable"
                      ? "enable"
                      : params.action === "disable"
                        ? "disable"
                    : "read",
            previewed: true,
            reversible: params.action !== "remove_custom",
            target:
              params.action === "set_route"
                ? `${params.route}:${params.provider_id}/${params.model_id}`
                : params.provider_id
                  ? `${params.provider_id}${params.model_id ? `/${params.model_id}` : ""}`
                  : "providers",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            reason: params.reason,
          })
          requireCapabilityDecision(gate.decision)
          if (gate.decision === "confirm") {
            yield* ctx.ask({
              permission: "edit",
              patterns: [`provider:${params.action}:${params.provider_id ?? "managed"}`],
              always: [],
              metadata: { provider_action: params.action, provider_id: params.provider_id },
            })
          }

          if (params.action === "list") {
            const [global, connected] = yield* Effect.all([config.getGlobal(), provider.list()])
            const custom = Object.entries(global.provider ?? {}).map(([id, item]) => ({
              id,
              name: item.name,
              protocol: item.protocol,
              api: item.api,
              models: Object.keys(item.models ?? {}).sort(),
              enabled: !global.disabled_providers?.includes(id),
            }))
            const discovered = Object.values(connected)
              .filter((item) => item.source !== "config")
              .map((item) => ({
                id: item.id,
                name: item.name,
                source: item.source,
                models: Object.keys(item.models).sort(),
              }))
            completeCapabilityOperation(gate.auditID, `completed (${custom.length} managed, ${discovered.length} discovered providers)`)
            return result(params.reason, { custom, discovered })
          }

          if (params.action === "remove_custom") {
            yield* config.removeGlobalCustomProvider(params.provider_id!)
            yield* config.invalidate(true)
            yield* provider.refresh()
            completeCapabilityOperation(gate.auditID, "completed")
            return result(params.reason, { removed: params.provider_id })
          }

          if (params.action === "enable" || params.action === "disable") {
            const global = yield* config.getGlobal()
            const disabled = new Set(global.disabled_providers ?? [])
            if (params.action === "enable") disabled.delete(params.provider_id!)
            else disabled.add(params.provider_id!)
            yield* config.updateGlobal({
              disabled_providers: disabled.size > 0 ? [...disabled].toSorted() : undefined,
            })
            yield* config.invalidate(true)
            yield* provider.refresh()
            completeCapabilityOperation(gate.auditID, "completed", {
              action: params.action === "enable" ? "disable" : "enable",
              provider: params.provider_id,
            })
            return result(params.reason, { provider: params.provider_id, enabled: params.action === "enable" })
          }

          if (params.action === "save_custom") {
            yield* config.upsertGlobalCustomProvider(params.provider_id!, params.config!, params.api_key)
            yield* config.invalidate(true)
            yield* provider.refresh()
            completeCapabilityOperation(gate.auditID, "completed", { action: "remove", provider: params.provider_id })
            return result(params.reason, { saved: params.provider_id, credential_updated: !!params.api_key })
          }

          if (params.action === "set_route") {
            const route = params.route!
            const reference = `${params.provider_id}/${params.model_id}`
            const global = yield* config.getGlobal()
            const patch =
              route === "primary"
                ? { model: reference }
                : route === "cheap"
                  ? { small_model: reference }
                  : {
                      model_groups: {
                        ...(global.model_groups ?? {}),
                        [route]: { default: reference, models: [reference] },
                      },
                    }
            yield* config.updateGlobal(patch)
            yield* config.invalidate(true)
            yield* provider.refresh()
            completeCapabilityOperation(gate.auditID, "completed", {
              action: "set_route",
              route,
              previous: route === "primary" ? global.model : route === "cheap" ? global.small_model : global.model_groups?.[route],
            })
            return result(params.reason, { route, model: reference })
          }

          const model = yield* provider.getModel(ProviderID.make(params.provider_id!), ModelID.make(params.model_id!))
          const language = yield* provider.getLanguage(model)
          yield* Effect.promise(() =>
            generateText({
              model: language,
              prompt: "Reply with ok.",
              maxOutputTokens: 4,
              abortSignal: ctx.abort,
            }),
          )
          completeCapabilityOperation(gate.auditID, "completed")
          return result(params.reason, { provider: params.provider_id, model: params.model_id, connected: true })
        }).pipe(Effect.orDie),
    }
  }),
)

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
