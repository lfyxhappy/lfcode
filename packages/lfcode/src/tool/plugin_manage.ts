import path from "path"
import z from "zod"
import { Effect } from "effect"

import { Instance } from "@/project/instance"
import {
  capabilitySourceFromPluginTrust,
  completeCapabilityOperation,
  decideCapabilityOperation,
  requireCapabilityDecision,
} from "@/capability/gate"
import {
  commitImport,
  exportPlugin,
  inspectImportPreview,
  listInstalledPlugins,
  previewDirectoryImport,
  previewNpmImport,
  previewZipImport,
  setPluginEnabled,
  uninstallPlugin,
} from "@/plugin/library"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["list", "inspect", "import_preview", "import_commit", "enable", "disable", "uninstall", "export"]),
  spec: z.string().optional(),
  source: z.enum(["npm", "directory", "zip"]).optional(),
  path: z.string().optional(),
  token: z.string().optional(),
  output: z.string().optional(),
  description: z.string().describe("Clear description of the plugin operation in 5-10 words."),
})

export const PluginManageTool = Tool.define(
  "plugin_manage",
  Effect.succeed({
    description:
      "Inspect and manage the global reviewed plugin library. Imports always require preview before commit; no force or review bypass is available.",
    parameters: Parameters,
    execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if (params.action === "list") {
          const items = yield* Effect.promise(() => listInstalledPlugins())
          return result(params.description, items.map(publicRecord))
        }
        if (params.action === "inspect") {
          if (!params.spec) throw new Error("plugin_manage inspect requires spec")
          const item = (yield* Effect.promise(() => listInstalledPlugins())).find((entry) => entry.spec === params.spec)
          if (!item) throw new Error(`Managed plugin not found: ${params.spec}`)
          return result(params.description, publicRecord(item))
        }
        if (params.action === "import_preview") {
          if (!params.path || !params.source) throw new Error("plugin_manage import_preview requires source and path")
          const preview = yield* Effect.promise(() => {
            if (params.source === "npm") return previewNpmImport({ spec: params.path! })
            if (params.source === "zip") return previewZipImport({ file: params.path! })
            return previewDirectoryImport({ directory: params.path! })
          })
          return result(params.description, preview)
        }

        const reviewed =
          params.action === "import_commit" && params.token
            ? yield* Effect.promise(() => inspectImportPreview(params.token!))
            : undefined
        const gate = decideCapabilityOperation({
          caller: `tool:plugin_manage`,
          capability: "plugin_manage",
          risk: params.action === "import_commit" ? "install" : params.action === "uninstall" ? "destructive" : "modify",
          source: reviewed ? capabilitySourceFromPluginTrust(reviewed.report.trust) : "plugin",
          operation:
            params.action === "import_commit"
              ? "install"
              : params.action === "uninstall"
                ? "delete"
                : params.action === "export"
                  ? "export"
                  : params.action === "enable"
                    ? "enable"
                    : "disable",
          previewed: params.action !== "import_commit" || Boolean(reviewed),
          reversible: params.action !== "uninstall",
          target: reviewed ? `lfplugin:${reviewed.report.id}` : (params.spec ?? params.output),
          reason: params.description,
          metadata: reviewed ? { pluginID: reviewed.report.id, digest: reviewed.report.source.digest } : undefined,
        })
        requireCapabilityDecision(gate.decision)
        if (gate.decision === "confirm") {
          yield* ctx.ask({
            permission: "edit",
            patterns: [
              `plugin:${params.action}:${reviewed ? `${reviewed.report.id}:${reviewed.report.source.digest.slice(0, 12)}` : (params.spec ?? params.output ?? "managed")}`,
            ],
            always: [],
            metadata: {
              plugin_action: params.action,
              spec: params.spec,
              output: params.output,
              ...(reviewed
                ? {
                    plugin_id: reviewed.report.id,
                    plugin_source: reviewed.report.source.type,
                    plugin_digest: reviewed.report.source.digest,
                  }
                : {}),
            },
          })
        }

        if (params.action === "import_commit") {
          if (!params.token) throw new Error("plugin_manage import_commit requires token")
          const item = yield* Effect.promise(() => commitImport(params.token!))
          completeCapabilityOperation(gate.auditID, "completed", { action: "uninstall", spec: item.spec })
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return result(params.description, publicRecord(item))
        }
        if (params.action === "enable" || params.action === "disable") {
          if (!params.spec) throw new Error(`plugin_manage ${params.action} requires spec`)
          const item = yield* Effect.promise(() => setPluginEnabled(params.spec!, params.action === "enable"))
          completeCapabilityOperation(gate.auditID, "completed", { action: "toggle", enabled: params.action !== "enable" })
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return result(params.description, item)
        }
        if (params.action === "uninstall") {
          if (!params.spec) throw new Error("plugin_manage uninstall requires spec")
          const item = yield* Effect.promise(() => uninstallPlugin(params.spec!))
          completeCapabilityOperation(gate.auditID, "completed")
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return result(params.description, item)
        }
        if (!params.spec || !params.output) throw new Error("plugin_manage export requires spec and output")
        const output = path.resolve(params.output)
        const item = yield* Effect.promise(() => exportPlugin(params.spec!, output))
        completeCapabilityOperation(gate.auditID, "completed")
        return result(params.description, item)
      }).pipe(Effect.orDie),
  }),
)

function publicRecord(item: Awaited<ReturnType<typeof listInstalledPlugins>>[number]) {
  const { directory: _directory, ...record } = item
  return record
}

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}
