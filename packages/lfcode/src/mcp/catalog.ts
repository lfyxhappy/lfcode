import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Config } from "@/config"
import { ConfigMCP } from "@/config/mcp"
import { Global } from "@/global"
import { InstanceState } from "@/effect"
import { MCP } from "./index"
import {
  MINIMAX_TOKEN_PLAN_MCP_DESCRIPTION,
  MINIMAX_TOKEN_PLAN_MCP_HOST,
  MINIMAX_TOKEN_PLAN_MCP_ID,
  MINIMAX_TOKEN_PLAN_MCP_INSTALL_REASON,
  MINIMAX_TOKEN_PLAN_MCP_TITLE,
  formatMiniMaxTokenPlanError,
  hasMiniMaxTokenPlanKey,
  minimaxTokenPlanConfig,
} from "./minimax-token-plan"

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0.1/"
const REGISTRY_CACHE_DIR = path.join(Global.Path.config, "mcps", "registry", "data")
const REGISTRY_CACHE_FILE = path.join(REGISTRY_CACHE_DIR, "servers.json")
const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000
const MANAGED_DIR_NAME = "mcps"
const MANIFEST_FILE = "manifest.json"
const WINDOWS_COMPUTER_USE_COMMAND = [
  "{env:LFCODE_BUNDLED_NODE}",
  "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js",
] as const
const WINDOWS_COMPUTER_USE_ENVIRONMENT = {
  ELECTRON_RUN_AS_NODE: "1",
} as const
const McpSource = z.enum(["official-registry", "builtin", "user"])
const InstallAdapterSchema = z.enum([
  "bundled-windows-computer-use",
  "bundled-codegraph",
  "minimax-token-plan",
  "registry-remote",
  "external-command",
])

const RegistryRemote = z.object({
  type: z.string(),
  url: z.string().url(),
})

const RegistryPackage = z.object({
  registryType: z.string(),
  identifier: z.string().optional(),
  version: z.string().optional(),
  file: z.string().url().optional(),
  sha256: z.string().optional(),
})

const RegistryServer = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  remotes: z.array(RegistryRemote).optional(),
  packages: z.array(RegistryPackage).optional(),
})

const RegistryServerListItem = z.object({
  server: RegistryServer,
  _meta: z.record(z.string(), z.unknown()).optional(),
})

const RegistryListResponse = z.object({
  servers: z.array(RegistryServerListItem),
  metadata: z
    .object({
      nextCursor: z.string().optional(),
      count: z.number().optional(),
    })
    .optional(),
})

export const ManagedMcpManifest = z.object({
  id: z.string(),
  serverName: z.string(),
  title: z.string(),
  source: McpSource,
  adapter: InstallAdapterSchema,
  installedAt: z.string(),
  configTarget: z.string(),
  configName: z.string(),
  payload: z
    .object({
      kind: z.enum(["none"]),
    })
    .optional(),
  upstream: z.object({
    url: z.string().url().optional(),
    version: z.string().optional(),
  }),
})
export type ManagedMcpManifest = z.infer<typeof ManagedMcpManifest>

export const McpCatalogItem = z.object({
  id: z.string(),
  serverName: z.string(),
  title: z.string(),
  description: z.string(),
  source: McpSource,
  packageType: z.string(),
  transportType: z.string(),
  installable: z.boolean(),
  installed: z.boolean(),
  installAdapter: InstallAdapterSchema.nullable(),
  installReason: z.string().optional(),
  official: z.boolean(),
  version: z.string().optional(),
})
export type McpCatalogItem = z.infer<typeof McpCatalogItem>

export const McpManageItem = z.object({
  name: z.string(),
  status: MCP.Status,
  origin: z
    .object({
      type: z.string(),
      source: z.string(),
    })
    .nullable(),
  managed: z.boolean(),
  installable: z.boolean(),
  installAdapter: InstallAdapterSchema.nullable(),
  manifest: ManagedMcpManifest.nullable(),
  config: ConfigMCP.Info.zod,
})
export type McpManageItem = z.infer<typeof McpManageItem>

export const CatalogInstallInput = z.object({
  id: z.string(),
  target: z.enum(["project", "global"]).optional(),
})
export type CatalogInstallInput = z.infer<typeof CatalogInstallInput>

type RegistryCache = {
  fetchedAt: number
  servers: z.infer<typeof RegistryServerListItem>[]
}

type CatalogState = {
  lastFetchedAt?: number
}

type InstallAdapter = z.infer<typeof InstallAdapterSchema>

type OfficialServer = z.infer<typeof RegistryServerListItem>

export interface Interface {
  readonly manage: () => Effect.Effect<McpManageItem[]>
  readonly catalog: (query?: { q?: string }) => Effect.Effect<McpCatalogItem[]>
  readonly install: (input: CatalogInstallInput) => Effect.Effect<McpManageItem>
  readonly removeManagedFiles: (name: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/McpCatalog") {}

function globalManagedRoot() {
  return path.join(Global.Path.config, MANAGED_DIR_NAME)
}

function projectManagedRoot(directory: string) {
  return path.join(directory, ".lfcode", MANAGED_DIR_NAME)
}

function managedRoot(directory: string, target: "project" | "global" | undefined) {
  if (target === "project") return projectManagedRoot(directory)
  return globalManagedRoot()
}

function managedPath(directory: string, name: string, target: "project" | "global" | undefined) {
  return path.join(managedRoot(directory, target), name)
}

function manifestPath(directory: string, name: string, target: "project" | "global" | undefined) {
  return path.join(managedPath(directory, name, target), MANIFEST_FILE)
}

function configTarget(target: "project" | "global" | undefined) {
  if (target === "project") return "project"
  return "global"
}

function bundledInfo(name: string): { title: string; adapter: InstallAdapter; config: ConfigMCP.Info } | undefined {
  if (name === MINIMAX_TOKEN_PLAN_MCP_ID) {
    return {
      title: MINIMAX_TOKEN_PLAN_MCP_TITLE,
      adapter: "minimax-token-plan",
      config: minimaxTokenPlanConfig(),
    }
  }

  if (name === "windows-computer-use") {
    return {
      title: "Windows Computer Use",
      adapter: "bundled-windows-computer-use",
      config: {
        type: "local",
        command: [...WINDOWS_COMPUTER_USE_COMMAND],
        environment: { ...WINDOWS_COMPUTER_USE_ENVIRONMENT },
        enabled: true,
      },
    }
  }

  if (name === "codegraph" && process.env.LFCODE_CODEGRAPH_NODE_EXE && process.env.LFCODE_CODEGRAPH_ENTRY) {
    return {
      title: "CodeGraph",
      adapter: "bundled-codegraph",
      config: {
        type: "local",
        command: ["{env:LFCODE_CODEGRAPH_NODE_EXE}", "{env:LFCODE_CODEGRAPH_ENTRY}", "serve", "--mcp"],
        enabled: true,
      },
    }
  }

  if (name === "codegraph" && process.env.LFCODE_CODEGRAPH_EXE) {
    return {
      title: "CodeGraph",
      adapter: "bundled-codegraph",
      config: {
        type: "local",
        command: ["{env:LFCODE_CODEGRAPH_EXE}", "serve", "--mcp"],
        enabled: true,
      },
    }
  }
}

export function minimaxTokenPlanCatalogItem(installed = false): McpCatalogItem {
  return {
    id: MINIMAX_TOKEN_PLAN_MCP_ID,
    serverName: MINIMAX_TOKEN_PLAN_MCP_ID,
    title: MINIMAX_TOKEN_PLAN_MCP_TITLE,
    description: MINIMAX_TOKEN_PLAN_MCP_DESCRIPTION,
    source: "builtin",
    packageType: "uvx",
    transportType: "stdio",
    installable: true,
    installed,
    installAdapter: "minimax-token-plan",
    installReason: MINIMAX_TOKEN_PLAN_MCP_INSTALL_REASON,
    official: true,
  }
}

function redactManagedConfig(name: string, config: ConfigMCP.Info): ConfigMCP.Info {
  if (name !== MINIMAX_TOKEN_PLAN_MCP_ID) return config
  if (config.type !== "local") return config
  return {
    ...config,
    environment: {
      ...config.environment,
      MINIMAX_API_KEY: "{env:MINIMAX_API_KEY}",
      MINIMAX_API_HOST: config.environment?.MINIMAX_API_HOST ?? MINIMAX_TOKEN_PLAN_MCP_HOST,
    },
  }
}

function statusForManagedItem(name: string, status: MCP.Status | undefined) {
  const current = status ?? { status: "disabled" as const }
  if (name !== MINIMAX_TOKEN_PLAN_MCP_ID || status?.status === "disabled") return current
  if (!hasMiniMaxTokenPlanKey()) {
    return {
      status: "failed" as const,
      error: formatMiniMaxTokenPlanError(new Error("MINIMAX_API_KEY is missing")),
    }
  }
  if (current.status !== "failed") return current
  return {
    status: "failed" as const,
    error: formatMiniMaxTokenPlanError(current.error),
  }
}

function installability(server: OfficialServer): {
  packageType: string
  transportType: string
  installable: boolean
  installAdapter: InstallAdapter | null
  installReason?: string
} {
  const name = server.server.name
  const bundled = bundledInfo(name)
  if (bundled) {
    return {
      packageType: "bundled",
      transportType: bundled.config.type,
      installable: true,
      installAdapter: bundled.adapter,
    }
  }

  const remote = server.server.remotes?.find((item) => item.type === "streamable-http" || item.type === "remote")
  if (remote) {
    return {
      packageType: "remote",
      transportType: remote.type,
      installable: true,
      installAdapter: "registry-remote",
    }
  }

  const pkg = server.server.packages?.[0]
  if (!pkg) {
    return {
      packageType: "unknown",
      transportType: "unknown",
      installable: false,
      installAdapter: null,
      installReason: "No supported remote transport or bundled recipe.",
    }
  }

  return {
    packageType: pkg.registryType,
    transportType: "package",
    installable: false,
    installAdapter: null,
    installReason: `Package type "${pkg.registryType}" is not supported for one-click install yet.`,
  }
}

async function fetchRegistryPage(cursor?: string) {
  const url = new URL("servers", REGISTRY_BASE_URL)
  url.searchParams.set("limit", "100")
  if (cursor) url.searchParams.set("cursor", cursor)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Registry request failed: ${response.status}`)
  return RegistryListResponse.parse(await response.json())
}

async function fetchRegistryServers() {
  const servers: z.infer<typeof RegistryServerListItem>[] = []
  let cursor: string | undefined

  while (true) {
    const page = await fetchRegistryPage(cursor).catch((error) => {
      if (servers.length > 0) return undefined
      throw error
    })
    if (!page) break
    servers.push(...page.servers)
    if (!page.metadata?.nextCursor) break
    cursor = page.metadata.nextCursor
  }

  return servers
}

async function readRegistryCache() {
  const raw = await fs.readFile(REGISTRY_CACHE_FILE, "utf8").catch(() => undefined)
  if (!raw) return
  const parsed = JSON.parse(raw) as RegistryCache
  if (!Array.isArray(parsed.servers) || typeof parsed.fetchedAt !== "number") return
  return parsed
}

async function writeRegistryCache(cache: RegistryCache) {
  await fs.mkdir(REGISTRY_CACHE_DIR, { recursive: true })
  await fs.writeFile(REGISTRY_CACHE_FILE, JSON.stringify(cache, null, 2))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service

    const state = yield* InstanceState.make<CatalogState>(() => Effect.succeed({}))

    const loadRegistry = Effect.fn("McpCatalog.loadRegistry")(function* () {
      const cached = yield* Effect.promise(() => readRegistryCache())
      const now = Date.now()
      const valid = cached && now - cached.fetchedAt < REGISTRY_CACHE_TTL_MS
      if (valid) return cached.servers

      const fetched = yield* Effect.tryPromise({
        try: async () => {
          const servers = await fetchRegistryServers()
          await writeRegistryCache({ fetchedAt: now, servers })
          return servers
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.catch((error) => {
          if (cached) return Effect.succeed(cached.servers)
          return Effect.fail(error)
        }),
      )

      yield* InstanceState.useEffect(state, (draft) => {
        draft.lastFetchedAt = now
        return Effect.void
      })
      return fetched
    })

    const readManifestAt = Effect.fn("McpCatalog.readManifestAt")(function* (
      directory: string,
      name: string,
      target: "project" | "global" | undefined,
    ) {
      const file = manifestPath(directory, name, target)
      if (!(yield* fsys.existsSafe(file))) return undefined
      const raw = yield* fsys.readFileString(file).pipe(Effect.orDie)
      return ManagedMcpManifest.parse(JSON.parse(raw))
    })

    const readManifest = Effect.fn("McpCatalog.readManifest")(function* (directory: string, name: string) {
      return (
        (yield* readManifestAt(directory, name, "global")) ??
        (yield* readManifestAt(directory, name, "project"))
      )
    })

    const writeManifest = Effect.fn("McpCatalog.writeManifest")(function* (
      directory: string,
      name: string,
      manifest: ManagedMcpManifest,
      target: "project" | "global" | undefined,
    ) {
      const file = manifestPath(directory, name, target)
      yield* fsys.writeWithDirs(file, JSON.stringify(manifest, null, 2))
    })

    const migrateLegacyManagedConfig = Effect.fn("McpCatalog.migrateLegacyManagedConfig")(function* () {
      const directory = yield* InstanceState.directory
      const legacyRoot = projectManagedRoot(directory)
      if (!(yield* fsys.existsSafe(legacyRoot))) return

      const entries = yield* fsys.readDirectoryEntries(legacyRoot).pipe(Effect.catch(() => Effect.succeed([])))
      const current = yield* config.get()
      const projectConfigFile = path.join(directory, ".lfcode", "lfcode.jsonc")

      for (const entry of entries) {
        if (entry.type !== "directory") continue
        const manifest = yield* readManifestAt(directory, entry.name, "project")
        if (!manifest) continue

        const name = manifest.configName || manifest.serverName
        const item = current.mcp?.[name]
        const origin = current.mcp_origins?.[name]

        if (item && origin?.source === projectConfigFile) {
          yield* config.upsertMcp(name, item, { target: "global" })
          yield* config.removeMcp(name)
        }

        yield* writeManifest(
          directory,
          name,
          {
            ...manifest,
            configTarget: Global.Path.config,
          },
          "global",
        )
        yield* fsys.remove(managedPath(directory, entry.name, "project"), { recursive: true }).pipe(Effect.catch(() => Effect.void))
      }
    })

    const removeManagedFiles: Interface["removeManagedFiles"] = Effect.fn("McpCatalog.removeManagedFiles")(function* (name: string) {
      const directory = yield* InstanceState.directory
      for (const target of [managedPath(directory, name, "global"), managedPath(directory, name, "project")]) {
        if (!(yield* fsys.existsSafe(target))) continue
        yield* fsys.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
      }
    })

    const manage: Interface["manage"] = Effect.fn("McpCatalog.manage")(function* () {
      yield* migrateLegacyManagedConfig().pipe(Effect.orDie)
      const current = yield* config.get()
      const statuses = yield* mcp.status()
      const directory = yield* InstanceState.directory
      const items = yield* Effect.forEach(
        Object.entries(current.mcp ?? {}).filter((entry): entry is [string, ConfigMCP.Info] => typeof entry[1] === "object" && entry[1] !== null && "type" in entry[1]),
        ([name, item]) =>
          Effect.gen(function* () {
            const manifest = yield* readManifest(directory, name)
            const bundled = bundledInfo(name)
            return {
              name,
              status: statusForManagedItem(name, statuses[name]),
              origin: current.mcp_origins?.[name] ?? null,
              managed: !!manifest,
              installable: !!bundled || (manifest?.adapter !== undefined && manifest.adapter !== "external-command") || item.type === "remote",
              installAdapter:
                manifest?.adapter === "external-command"
                  ? null
                  : manifest?.adapter ?? bundled?.adapter ?? (item.type === "remote" ? "registry-remote" : null),
              manifest: manifest ?? null,
              config: redactManagedConfig(name, item),
            } satisfies McpManageItem
          }),
        { concurrency: "unbounded" },
      )
      return items.toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const catalog: Interface["catalog"] = (query) =>
      Effect.fn("McpCatalog.catalog")(function* () {
        const servers = yield* loadRegistry().pipe(Effect.catch(() => Effect.succeed([] as OfficialServer[])))
        const current = yield* config.get()
        const term = query?.q?.trim().toLowerCase() ?? ""
        const registryItems = servers
          .map((item: OfficialServer) => {
            const meta = item._meta?.["io.modelcontextprotocol.registry/official"]
            const install = installability(item)
            return {
              id: item.server.name,
              serverName: item.server.name,
              title: item.server.title ?? item.server.name,
              description: item.server.description ?? "",
              source: "official-registry" as const,
              packageType: install.packageType,
              transportType: install.transportType,
              installable: install.installable,
              installed: !!current.mcp?.[item.server.name],
              installAdapter: install.installAdapter,
              installReason: install.installReason,
              official: Boolean(meta && typeof meta === "object"),
              version: item.server.version,
            } satisfies McpCatalogItem
          })
          .filter((item: McpCatalogItem) => {
            if (!term) return true
            return [item.serverName, item.title, item.description, item.packageType].some((value) => value.toLowerCase().includes(term))
          })
          .toSorted((a: McpCatalogItem, b: McpCatalogItem) => a.title.localeCompare(b.title))
        return [minimaxTokenPlanCatalogItem(!!current.mcp?.[MINIMAX_TOKEN_PLAN_MCP_ID]), ...registryItems]
          .filter((item: McpCatalogItem) => {
            if (!term) return true
            return [item.serverName, item.title, item.description, item.packageType, item.installReason ?? ""].some((value) =>
              value.toLowerCase().includes(term),
            )
          })
          .toSorted((a: McpCatalogItem, b: McpCatalogItem) => a.title.localeCompare(b.title))
      })().pipe(Effect.orDie)

    const install: Interface["install"] = (input) =>
      Effect.fn("McpCatalog.install")(function* () {
        yield* migrateLegacyManagedConfig().pipe(Effect.orDie)
        const directory = yield* InstanceState.directory
        const catalogItems = yield* catalog()
        const item = catalogItems.find((entry: McpCatalogItem) => entry.id === input.id)
        if (!item) return yield* Effect.die(new Error(`MCP catalog item ${input.id} not found`))
        if (!item.installable || !item.installAdapter) {
          return yield* Effect.die(new Error(item.installReason ?? `MCP ${input.id} is not installable`))
        }

        const isMiniMaxTokenPlan = item.installAdapter === "minimax-token-plan"
        const server = isMiniMaxTokenPlan
          ? undefined
          : (yield* loadRegistry()).find((entry: OfficialServer) => entry.server.name === input.id)
        if (!isMiniMaxTokenPlan && !server) return yield* Effect.die(new Error(`Registry definition not found for ${input.id}`))

        const target = configTarget(input.target)
        const existingManifest = yield* readManifestAt(directory, item.serverName, target)
        const installedAt = existingManifest?.adapter === item.installAdapter ? existingManifest.installedAt : new Date().toISOString()
        const bundled = bundledInfo(item.serverName)
        const nextConfig =
          item.installAdapter === "registry-remote"
            ? yield* Effect.sync(() => {
                const remote = server!.server.remotes?.find((entry) => entry.type === "streamable-http" || entry.type === "remote")
                if (!remote) throw new Error(`Registry server ${input.id} has no supported remote transport`)
                return {
                  type: "remote" as const,
                  url: remote.url,
                  enabled: true,
                } satisfies ConfigMCP.Info
              }).pipe(Effect.orDie)
            : bundled?.config

        if (!nextConfig) return yield* Effect.die(new Error(`Missing install config for ${input.id}`))

        const updated = yield* config.upsertMcp(item.serverName, nextConfig, { target })
        const configFile = target === "global" ? Global.Path.config : path.join(directory, ".lfcode", "lfcode.jsonc")
        yield* writeManifest(directory, item.serverName, {
          id: item.id,
          serverName: item.serverName,
          title: item.title,
          source: isMiniMaxTokenPlan ? "builtin" : "official-registry",
          adapter: item.installAdapter,
          installedAt,
          configTarget: configFile,
          configName: item.serverName,
          payload: { kind: "none" },
          upstream: {
            url: nextConfig.type === "remote" ? nextConfig.url : undefined,
            version: server?.server.version,
          },
        }, target)
        const status = statusForManagedItem(item.serverName, (yield* mcp.status())[item.serverName])
        return {
          name: item.serverName,
          status,
          origin: updated.mcp_origins?.[item.serverName] ?? null,
          managed: true,
          installable: true,
          installAdapter: item.installAdapter,
          manifest: (yield* readManifestAt(directory, item.serverName, target)) ?? null,
          config: redactManagedConfig(item.serverName, nextConfig),
        }
      })().pipe(Effect.orDie)

    return Service.of({
      manage,
      catalog,
      install,
      removeManagedFiles,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as McpCatalog from "./catalog"
