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
import { Flag } from "@/flag/flag"

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0.1/"
const REGISTRY_CACHE_DIR = path.join(Global.Path.cache, "mcp-registry")
const REGISTRY_CACHE_FILE = path.join(REGISTRY_CACHE_DIR, "servers.json")
const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000
const MANAGED_DIR_NAME = "mcps"
const MANIFEST_FILE = "manifest.json"
const PLAYWRIGHT_DESKTOP_REMOTE_CONFIG = {
  type: "remote",
  url: "{env:LFCODE_SERVER_URL}/global/mcp/playwright",
  headers: {
    authorization: "{env:LFCODE_SERVER_AUTH}",
  },
  enabled: true,
} as const
const PLAYWRIGHT_EXTERNAL_COMMAND = ["cmd", "/c", "npx", "-y", "@playwright/mcp@0.0.73", "--browser", "chrome"] as const
const WINDOWS_COMPUTER_USE_COMMAND = [
  "{env:LFCODE_BUNDLED_NODE}",
  "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js",
] as const
const WINDOWS_COMPUTER_USE_ENVIRONMENT = {
  ELECTRON_RUN_AS_NODE: "1",
} as const

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
  source: z.literal("official-registry"),
  adapter: z.enum(["bundled-playwright", "bundled-windows-computer-use", "registry-remote"]),
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
  source: z.literal("official-registry"),
  packageType: z.string(),
  transportType: z.string(),
  installable: z.boolean(),
  installed: z.boolean(),
  installAdapter: z.enum(["bundled-playwright", "bundled-windows-computer-use", "registry-remote"]).nullable(),
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
  installAdapter: z.enum(["bundled-playwright", "bundled-windows-computer-use", "registry-remote"]).nullable(),
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

type InstallAdapter = "bundled-playwright" | "bundled-windows-computer-use" | "registry-remote"

type OfficialServer = z.infer<typeof RegistryServerListItem>

export interface Interface {
  readonly manage: () => Effect.Effect<McpManageItem[]>
  readonly catalog: (query?: { q?: string }) => Effect.Effect<McpCatalogItem[]>
  readonly install: (input: CatalogInstallInput) => Effect.Effect<McpManageItem>
  readonly removeManagedFiles: (name: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/McpCatalog") {}

function managedRoot(directory: string) {
  return path.join(directory, ".lfcode", MANAGED_DIR_NAME)
}

function managedPath(directory: string, name: string) {
  return path.join(managedRoot(directory), name)
}

function manifestPath(directory: string, name: string) {
  return path.join(managedPath(directory, name), MANIFEST_FILE)
}

function configTarget(target: "project" | "global" | undefined) {
  if (target === "global") return "global"
  return "project"
}

function bundledInfo(name: string): { title: string; adapter: InstallAdapter; config: ConfigMCP.Info } | undefined {
  if (name === "playwright") {
    return {
      title: "Playwright",
      adapter: "bundled-playwright",
      config:
        Flag.LFCODE_CLIENT === "desktop"
          ? PLAYWRIGHT_DESKTOP_REMOTE_CONFIG
          : {
              type: "local",
              command: [...PLAYWRIGHT_EXTERNAL_COMMAND],
              enabled: true,
            },
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

    const readManifest = Effect.fn("McpCatalog.readManifest")(function* (directory: string, name: string) {
      const file = manifestPath(directory, name)
      if (!(yield* fsys.existsSafe(file))) return undefined
      const raw = yield* fsys.readFileString(file).pipe(Effect.orDie)
      return ManagedMcpManifest.parse(JSON.parse(raw))
    })

    const writeManifest = Effect.fn("McpCatalog.writeManifest")(function* (directory: string, name: string, manifest: ManagedMcpManifest) {
      const file = manifestPath(directory, name)
      yield* fsys.writeWithDirs(file, JSON.stringify(manifest, null, 2))
    })

    const removeManagedFiles: Interface["removeManagedFiles"] = Effect.fn("McpCatalog.removeManagedFiles")(function* (name: string) {
      const directory = yield* InstanceState.directory
      const target = managedPath(directory, name)
      if (!(yield* fsys.existsSafe(target))) return
      yield* fsys.remove(target, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    })

    const manage: Interface["manage"] = Effect.fn("McpCatalog.manage")(function* () {
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
              status: statuses[name] ?? { status: "disabled" as const },
              origin: current.mcp_origins?.[name] ?? null,
              managed: !!manifest,
              installable: !!bundled || !!manifest?.adapter || item.type === "remote",
              installAdapter: manifest?.adapter ?? bundled?.adapter ?? (item.type === "remote" ? "registry-remote" : null),
              manifest: manifest ?? null,
              config: item,
            } satisfies McpManageItem
          }),
        { concurrency: "unbounded" },
      )
      return items.toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const catalog: Interface["catalog"] = (query) =>
      Effect.fn("McpCatalog.catalog")(function* () {
        const servers = yield* loadRegistry()
        const current = yield* config.get()
        const term = query?.q?.trim().toLowerCase() ?? ""
        return servers
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
      })().pipe(Effect.orDie)

    const install: Interface["install"] = (input) =>
      Effect.fn("McpCatalog.install")(function* () {
        const directory = yield* InstanceState.directory
        const catalogItems = yield* catalog()
        const item = catalogItems.find((entry: McpCatalogItem) => entry.id === input.id)
        if (!item) return yield* Effect.die(new Error(`MCP catalog item ${input.id} not found`))
        if (!item.installable || !item.installAdapter) {
          return yield* Effect.die(new Error(item.installReason ?? `MCP ${input.id} is not installable`))
        }

        const server = (yield* loadRegistry()).find((entry: OfficialServer) => entry.server.name === input.id)
        if (!server) return yield* Effect.die(new Error(`Registry definition not found for ${input.id}`))

        const installedAt = new Date().toISOString()
        const bundled = bundledInfo(item.serverName)
        const nextConfig =
          item.installAdapter === "registry-remote"
            ? yield* Effect.sync(() => {
                const remote = server.server.remotes?.find((entry) => entry.type === "streamable-http" || entry.type === "remote")
                if (!remote) throw new Error(`Registry server ${input.id} has no supported remote transport`)
                return {
                  type: "remote" as const,
                  url: remote.url,
                  enabled: true,
                } satisfies ConfigMCP.Info
              }).pipe(Effect.orDie)
            : bundled?.config

        if (!nextConfig) return yield* Effect.die(new Error(`Missing install config for ${input.id}`))

        const updated = yield* config.upsertMcp(item.serverName, nextConfig, { target: configTarget(input.target) })
        const configFile =
          input.target === "global" ? Global.Path.config : path.join(directory, ".lfcode", "lfcode.jsonc")
        yield* writeManifest(directory, item.serverName, {
          id: item.id,
          serverName: item.serverName,
          title: item.title,
          source: "official-registry",
          adapter: item.installAdapter,
          installedAt,
          configTarget: configFile,
          configName: item.serverName,
          payload: { kind: "none" },
          upstream: {
            url: nextConfig.type === "remote" ? nextConfig.url : undefined,
            version: server.server.version,
          },
        })
        const status = (yield* mcp.status())[item.serverName] ?? { status: "disabled" as const }
        return {
          name: item.serverName,
          status,
          origin: updated.mcp_origins?.[item.serverName] ?? null,
          managed: true,
          installable: true,
          installAdapter: item.installAdapter,
          manifest: (yield* readManifest(directory, item.serverName)) ?? null,
          config: nextConfig,
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
