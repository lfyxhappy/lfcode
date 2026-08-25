import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({})

export const AppGetAutomationStatusTool = Tool.define(
  "app_get_automation_status",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Read the running local desktop automation bridge protocol, granted capability, and supported diagnostic features before using app-control actions.",
      parameters,
      execute: () =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() => client.getMetadata())
          return {
            title: "Read desktop automation status",
            output: JSON.stringify(result, null, 2),
            metadata: {
              protocolVersion: result.protocolVersion,
              instanceID: result.instanceID,
              capability: result.capability,
              features: result.features,
            },
          }
        }),
    }
  }),
)

export { parameters }
