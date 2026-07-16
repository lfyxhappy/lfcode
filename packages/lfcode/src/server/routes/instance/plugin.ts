import path from "path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { Config } from "@/config"
import { ConfigPlugin } from "@/config/plugin"
import { Global } from "@/global"
import { InstallationVersion } from "@/installation/version"
import { Npm } from "@/npm"
import {
  checkPluginCompatibility,
  createPluginEntry,
  parsePluginSpecifier,
  pluginSource,
  readPluginManifestSummary,
  readPluginPackage,
  resolvePluginTarget,
  resolvePathPluginTarget,
} from "@/plugin/shared"
import { Filesystem } from "@/util"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import {
  commitImport,
  exportPlugin,
  isManagedPluginSpecifier,
  listInstalledPlugins,
  previewDirectoryImport,
  previewNpmImport,
  previewZipImport,
  setPluginEnabled,
  uninstallPlugin,
} from "@/plugin/library"

const PluginTargetStatus = z
  .object({
    status: z.enum(["ready", "missing", "unresolved", "error"]),
    target: z.string().optional(),
    entry: z.string().optional(),
    message: z.string().optional(),
  })
  .meta({ ref: "PluginTargetStatus" })

const PluginRuntimeStatus = z
  .object({
    id: z.string(),
    lifecycle: z.enum(["active", "disabled", "degraded"]),
    error: z.string().optional(),
  })
  .meta({ ref: "PluginRuntimeStatus" })

const PluginToggle = z
  .object({
    spec: z.string(),
    enabled: z.boolean(),
  })
  .meta({ ref: "PluginToggle" })

const PluginLibraryPreviewInput = z
  .object({ source: z.enum(["npm", "directory", "zip"]), path: z.string().min(1) })
  .meta({ ref: "PluginLibraryPreviewInput" })

const PluginLibraryCommitInput = z.object({ token: z.string().min(1) }).meta({ ref: "PluginLibraryCommitInput" })

const PluginLibrarySpecInput = z.object({ spec: z.string().min(1) }).meta({ ref: "PluginLibrarySpecInput" })

const PluginLibraryToggleInput = z
  .object({ spec: z.string().min(1), enabled: z.boolean() })
  .meta({ ref: "PluginLibraryToggleInput" })

const PluginLibraryExportInput = z
  .object({ spec: z.string().min(1), output: z.string().min(1) })
  .meta({ ref: "PluginLibraryExportInput" })

const PluginLibrarySource = z.object({
  type: z.enum(["npm", "directory", "zip", "generated", "bundled", "internal"]),
  label: z.string(),
  digest: z.string(),
})

const PluginLibraryReport = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    category: z.enum(["tool", "provider", "integration", "ui", "theme", "runtime", "mixed"]),
    capabilities: z.array(z.string()),
    trust: z.enum(["bundled", "official", "dev-local", "external"]),
    apiVersion: z.string(),
    lfcodeRange: z.string().optional(),
    entrypoints: z.array(z.string()),
    runtimeDependencies: z.array(
      z.object({ id: z.string(), version: z.string().optional(), required: z.boolean().optional() }),
    ),
    dependencies: z.array(
      z.object({
        name: z.string(),
        requested: z.string(),
        version: z.string().optional(),
        integrity: z.string().optional(),
        optional: z.boolean(),
      }),
    ),
    source: PluginLibrarySource,
    files: z.object({ count: z.number(), bytes: z.number() }),
    operation: z.enum(["install", "replace", "unchanged"]),
    warnings: z.array(z.string()),
  })
  .meta({ ref: "PluginLibraryReport" })

const PluginLibraryRecord = PluginLibraryReport.extend({
  installedAt: z.number(),
  enabled: z.boolean(),
  spec: z.string(),
}).meta({ ref: "PluginLibraryRecord" })

const PluginLibraryPreview = z
  .object({ token: z.string(), expiresAt: z.number(), report: PluginLibraryReport })
  .meta({ ref: "PluginLibraryPreview" })

const PluginLibraryToggleResult = z
  .object({ spec: z.string(), enabled: z.boolean() })
  .meta({ ref: "PluginLibraryToggleResult" })

const PluginLibraryUninstallResult = z
  .object({ spec: z.string(), uninstalled: z.literal(true) })
  .meta({ ref: "PluginLibraryUninstallResult" })

const PluginLibraryExportResult = z
  .object({ file: z.string(), bytes: z.number(), files: z.number() })
  .meta({ ref: "PluginLibraryExportResult" })

const PluginManifestSummary = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    category: z.enum(["tool", "provider", "integration", "ui", "theme", "runtime", "mixed"]).optional(),
    trust: z.string().optional(),
    apiVersion: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    lfcodeRange: z.string().optional(),
    runtimeDependencies: z
      .array(
        z.object({
          id: z.string(),
          version: z.string().optional(),
          required: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .meta({ ref: "PluginManifestSummary" })

const PluginInspect = z
  .object({
    spec: z.string(),
    scope: z.enum(["global", "local"]),
    source: z.enum(["file", "npm", "managed"]),
    declaredIn: z.string(),
    packageName: z.string().optional(),
    enabled: z.boolean(),
    manifest: PluginManifestSummary.optional(),
    compatible: z.boolean(),
    compatibilityMessage: z.string().optional(),
    server: PluginTargetStatus,
    tui: PluginTargetStatus,
    runtime: PluginRuntimeStatus.optional(),
  })
  .meta({ ref: "PluginInspect" })

function unresolvedTarget(message: string) {
  return {
    status: "unresolved" as const,
    message,
  }
}

function errorTarget(target: string | undefined, message: string) {
  return {
    status: "error" as const,
    target,
    message,
  }
}

async function inspectPluginTarget(spec: string, kind: "server" | "tui", target?: string) {
  if (!target) return unresolvedTarget("Plugin target is not installed")
  try {
    const entry = await createPluginEntry(spec, target, kind)
    if (!entry.entry) {
      return {
        status: "missing" as const,
        target: entry.target,
        message: `Plugin ${spec} does not expose a ${kind} entrypoint`,
      }
    }
    return {
      status: "ready" as const,
      target: entry.target,
      entry: entry.entry,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorTarget(target, message)
  }
}

async function inspectPlugin(spec: string, scope: "global" | "local", declaredIn: string, enabled: boolean) {
  const source = pluginSource(spec)
  const packageName = source === "npm" ? parsePluginSpecifier(spec).pkg : undefined
  const target = await resolveInspectTarget(spec, source, packageName)
  const pkg = target ? await readPluginPackage(target).catch(() => undefined) : undefined
  const compatible = await inspectCompatibility(source, target, pkg)
  const manifest = readPluginManifestSummary(spec, pkg)
  return {
    spec,
    scope,
    source,
    declaredIn,
    packageName,
    enabled,
    ...(manifest ? { manifest } : {}),
    compatible: compatible.ok,
    ...(compatible.message ? { compatibilityMessage: compatible.message } : {}),
    server: await inspectPluginTarget(spec, "server", target),
    tui: await inspectPluginTarget(spec, "tui", target),
  }
}

async function resolveInspectTarget(spec: string, source: "file" | "npm" | "managed", packageName?: string) {
  if (source === "file") {
    return resolvePathPluginTarget(spec).catch(() => undefined)
  }
  if (source === "managed") {
    return resolvePluginTarget(spec).catch(() => undefined)
  }
  if (!packageName) return
  const root = path.join(Global.Path.cache, "packages", Npm.sanitize(spec))
  const target = path.join(root, "node_modules", packageName)
  if (!(await Filesystem.exists(target))) return
  return target
}

async function inspectCompatibility(
  source: "file" | "npm" | "managed",
  target: string | undefined,
  pkg: Awaited<ReturnType<typeof readPluginPackage>> | undefined,
) {
  if (source === "file" || !target) return { ok: true as const }
  try {
    await checkPluginCompatibility(target, InstallationVersion, pkg)
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export const PluginRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List configured plugins",
        description: "Inspect configured plugins without triggering installation side effects.",
        operationId: "plugin.list",
        responses: {
          200: {
            description: "Plugin inspect list",
            content: {
              "application/json": {
                schema: resolver(PluginInspect.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("PluginRoutes.list", c, function* () {
          const cfg = yield* Config.Service
          const info = yield* cfg.get()
          const runtime = yield* Plugin.Service.use((svc) => svc.status())
          return yield* Effect.promise(() =>
            Promise.all(
              (info.plugin_origins ?? []).map(async (origin) => {
                const spec = ConfigPlugin.pluginSpecifier(origin.spec)
                const entry = await inspectPlugin(
                  spec,
                  origin.scope,
                  origin.source,
                  info.plugin_enabled?.[spec] !== false,
                )
                const active = runtime.find((item) => item.spec === spec)
                if (!active) return entry
                return {
                  ...entry,
                  runtime: {
                    id: active.id,
                    lifecycle: active.lifecycle,
                    ...(active.error ? { error: active.error } : {}),
                  },
                }
              }),
            ),
          )
        }),
    )
    .get(
      "/library",
      describeRoute({
        summary: "List managed plugins",
        operationId: "plugin.libraryList",
        responses: {
          200: {
            description: "Managed plugin list",
            content: { "application/json": { schema: resolver(PluginLibraryRecord.array()) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("PluginRoutes.libraryList", c, function* () {
          return yield* Effect.promise(() => listInstalledPlugins().then((items) => items.map(publicLibraryRecord)))
        }),
    )
    .post(
      "/library/preview",
      describeRoute({
        summary: "Preview a plugin import",
        operationId: "plugin.libraryPreview",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PluginLibraryPreviewInput" } } },
        },
        responses: {
          200: {
            description: "Plugin import preview",
            content: { "application/json": { schema: resolver(PluginLibraryPreview) } },
          },
        },
      }),
      validator("json", PluginLibraryPreviewInput),
      async (c) =>
        jsonRequest("PluginRoutes.libraryPreview", c, function* () {
          const input = c.req.valid("json")
          return yield* Effect.promise(() => {
            if (input.source === "npm") return previewNpmImport({ spec: input.path })
            if (input.source === "zip") return previewZipImport({ file: input.path })
            return previewDirectoryImport({ directory: input.path })
          })
        }),
    )
    .post(
      "/library/commit",
      describeRoute({
        summary: "Commit a previewed plugin import",
        operationId: "plugin.libraryCommit",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PluginLibraryCommitInput" } } },
        },
        responses: {
          200: {
            description: "Installed plugin",
            content: { "application/json": { schema: resolver(PluginLibraryRecord) } },
          },
        },
      }),
      validator("json", PluginLibraryCommitInput),
      async (c) =>
        jsonRequest("PluginRoutes.libraryCommit", c, function* () {
          const result = yield* Effect.promise(() => commitImport(c.req.valid("json").token))
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return publicLibraryRecord(result)
        }),
    )
    .post(
      "/library/toggle",
      describeRoute({
        summary: "Enable or disable a managed plugin",
        operationId: "plugin.libraryToggle",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PluginLibraryToggleInput" } } },
        },
        responses: {
          200: {
            description: "Managed plugin state",
            content: { "application/json": { schema: resolver(PluginLibraryToggleResult) } },
          },
        },
      }),
      validator("json", PluginLibraryToggleInput),
      async (c) =>
        jsonRequest("PluginRoutes.libraryToggle", c, function* () {
          const input = c.req.valid("json")
          const result = yield* Effect.promise(() => setPluginEnabled(input.spec, input.enabled))
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return result
        }),
    )
    .post(
      "/library/uninstall",
      describeRoute({
        summary: "Uninstall a managed plugin",
        operationId: "plugin.libraryUninstall",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PluginLibrarySpecInput" } } },
        },
        responses: {
          200: {
            description: "Uninstall result",
            content: { "application/json": { schema: resolver(PluginLibraryUninstallResult) } },
          },
        },
      }),
      validator("json", PluginLibrarySpecInput),
      async (c) =>
        jsonRequest("PluginRoutes.libraryUninstall", c, function* () {
          const result = yield* Effect.promise(() => uninstallPlugin(c.req.valid("json").spec))
          yield* Effect.promise(() => Instance.invalidateAllCaches())
          return result
        }),
    )
    .post(
      "/library/export",
      describeRoute({
        summary: "Export a managed plugin",
        operationId: "plugin.libraryExport",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PluginLibraryExportInput" } } },
        },
        responses: {
          200: {
            description: "Export result",
            content: { "application/json": { schema: resolver(PluginLibraryExportResult) } },
          },
        },
      }),
      validator("json", PluginLibraryExportInput),
      async (c) =>
        jsonRequest("PluginRoutes.libraryExport", c, function* () {
          const input = c.req.valid("json")
          return yield* Effect.promise(() => exportPlugin(input.spec, input.output))
        }),
    )
    .post(
      "/toggle",
      describeRoute({
        summary: "Enable or disable a configured plugin",
        operationId: "plugin.toggle",
        responses: {
          200: {
            description: "Plugin toggle completed",
            content: {
              "application/json": {
                schema: resolver(PluginToggle),
              },
            },
          },
        },
      }),
      validator("json", PluginToggle),
      async (c) =>
        jsonRequest("PluginRoutes.toggle", c, function* () {
          const input = c.req.valid("json")
          if (isManagedPluginSpecifier(input.spec)) {
            const result = yield* Effect.promise(() => setPluginEnabled(input.spec, input.enabled))
            yield* Effect.promise(() => Instance.invalidateAllCaches())
            return result
          }
          const cfg = yield* Config.Service
          const plugin = yield* Plugin.Service
          yield* cfg.updatePluginEnabled(input.spec, input.enabled)
          yield* plugin.reload()
          return input
        }),
    ),
)

function publicLibraryRecord(item: Awaited<ReturnType<typeof listInstalledPlugins>>[number]) {
  const { directory: _directory, ...record } = item
  return record
}
