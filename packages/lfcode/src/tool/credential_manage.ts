import z from "zod"
import { Effect } from "effect"
import { Auth } from "@/auth"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "set_api_key", "remove"]),
  provider_id: z.string().min(1).optional(),
  api_key: z.string().min(1).optional().describe("Credential value to store. It is never returned or written to audit metadata."),
  reason: z.string().min(1).describe("Short reason for this credential operation."),
})

export const CredentialManageTool = Tool.define(
  "credential_manage",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return {
      description: "List credential metadata, store an API key, or remove a provider credential. Credential values are never returned or audited, and every mutation requires confirmation.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action !== "list" && !params.provider_id) throw new Error(`credential_manage ${params.action} requires provider_id`)
          if (params.action === "set_api_key" && !params.api_key) throw new Error("credential_manage set_api_key requires api_key")
          const gate = decideCapabilityOperation({
            caller: "tool:credential_manage",
            capability: "credential_manage",
            risk: params.action === "list" ? "read" : params.action === "remove" ? "destructive" : "credential",
            source: "core",
            operation: params.action === "list" ? "read" : params.action === "remove" ? "delete" : "update",
            previewed: true,
            reversible: params.action !== "remove",
            target: params.provider_id ?? "credentials",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            reason: params.reason,
          })
          requireCapabilityDecision(gate.decision)
          if (gate.decision === "confirm") {
            yield* ctx.ask({
              permission: "edit",
              patterns: [`credential:${params.action}:${params.provider_id ?? "managed"}`],
              always: [],
              metadata: { credential_action: params.action, provider_id: params.provider_id },
            })
          }

          if (params.action === "list") {
            const entries = Object.entries(yield* auth.all()).map(([providerID, credential]) => ({ provider_id: providerID, type: credential.type }))
            completeCapabilityOperation(gate.auditID, `completed (${entries.length} credentials)`)
            return result(params.reason, entries)
          }
          if (params.action === "remove") {
            yield* auth.remove(params.provider_id!)
            completeCapabilityOperation(gate.auditID, "completed")
            return result(params.reason, { provider_id: params.provider_id, removed: true })
          }
          yield* auth.set(params.provider_id!, { type: "api", key: params.api_key! })
          completeCapabilityOperation(gate.auditID, "completed", { action: "remove", provider_id: params.provider_id })
          return result(params.reason, { provider_id: params.provider_id, credential_updated: true })
        }).pipe(Effect.orDie),
    }
  }),
)

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
