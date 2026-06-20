import { accessSync, copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { copyFile, readFile } from "node:fs/promises"
import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { App } from "electron"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const CONFIG_FILES = ["lfcode.jsonc", "lfcode.json", "config.json"] as const
const MANAGED_ROOT_DIR = ".lfcode"
const PLAYWRIGHT_MCP_COMMAND = ["cmd", "/c", "npx", "-y", "@playwright/mcp@0.0.73"] as const
const PLAYWRIGHT_MCP_CDP_COMMAND = [...PLAYWRIGHT_MCP_COMMAND, "--cdp-endpoint=http://127.0.0.1:9222"] as const
const PLAYWRIGHT_MCP_LEGACY_COMMAND = [...PLAYWRIGHT_MCP_COMMAND, "--browser", "chrome"] as const
const WINDOWS_COMPUTER_USE_MCP_LEGACY_COMMAND = [
  "cmd",
  "/c",
  "node",
  "\"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js\"",
] as const
const WINDOWS_COMPUTER_USE_MCP_COMMAND = ["node", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"] as const
const PLAYWRIGHT_MCP_KEYS = ["type", "command", "enabled"] as const
const WINDOWS_COMPUTER_USE_MCP_KEYS = ["type", "command", "enabled"] as const
const DEFAULT_ROOT_CONFIG = {
  $schema: "https://lfcode.ai/config.json",
  mcp: {
    playwright: {
      type: "local",
      command: PLAYWRIGHT_MCP_CDP_COMMAND,
      enabled: true,
    },
    "windows-computer-use": {
      type: "local",
      command: WINDOWS_COMPUTER_USE_MCP_COMMAND,
      enabled: true,
    },
  },
} as const

type RootEnv = {
  readonly LFCODE_CONFIG_DIR: string
  readonly LFCODE_DATA_DIR: string
  readonly LFCODE_STATE_DIR: string
  readonly LFCODE_CACHE_DIR: string
}

export type RootLayout = {
  readonly root: string
  readonly configDir: string
  readonly configFile: string
  readonly dataDir: string
  readonly stateDir: string
  readonly cacheDir: string
  readonly userDataDir: string
  readonly migrationMarker: string
}

export type MigrationSummary = {
  readonly marker: string
  readonly performed: boolean
  readonly reason?: string
  readonly copied: readonly string[]
  readonly preserved: readonly string[]
}

export type DesktopBootstrapState = {
  readonly appId: string
  readonly appName: string
  readonly env: Partial<RootEnv>
  readonly fallbackReason?: string
  readonly layout?: RootLayout
  readonly migration?: MigrationSummary
  readonly mode: "legacy" | "root"
  readonly notes: readonly string[]
  readonly rootKind?: "managed" | "portable"
  readonly userDataDir: string
}

type BootstrapTargetInput = {
  readonly appId: string
  readonly appName: string
  readonly legacyUserDataDir: string
  readonly root: string | undefined
  readonly rootKind?: "managed" | "portable"
  readonly rootWritable: boolean
}

type DesktopBootstrapInput = {
  readonly appId: string
  readonly appName: string
  readonly execPath: string
  readonly homeDir?: string
  readonly isPackaged: boolean
  readonly legacyUserDataDir: string
  readonly migrationSources?: readonly Partial<MigrationSources>[]
  readonly platform: string
  readonly portableRoot?: string
}

type MigrationSources = {
  readonly cacheDir: string
  readonly configDir: string
  readonly dataDir: string
  readonly stateDir: string
  readonly userDataDir: string
}

let bootstrapState: DesktopBootstrapState | undefined

export function applyBootstrapState(app: App, state: DesktopBootstrapState) {
  app.setName(state.appName)
  app.setAppUserModelId(state.appId)
  if (state.layout) ensureRootLayoutSync(state.layout)
  process.env.LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR = app.isPackaged
    ? join(process.resourcesPath, "mcp", "windows-computer-use-mcp").replaceAll("\\", "/")
    : join(app.getAppPath(), "../../.windows-computer-use-mcp").replaceAll("\\", "/")
  for (const [key, value] of Object.entries(state.env)) {
    if (!value) continue
    process.env[key] = value
  }
  app.setPath("userData", state.userDataDir)
}

export async function canWriteDirectory(directory: string) {
  const probe = join(resolveProbeDirectory(directory), `.lfcode-write-test-${process.pid}-${Date.now()}`)
  const wrote = await writeFile(probe, "").then(
    () => true,
    () => false,
  )
  if (!wrote) return false
  await unlink(probe).catch(() => undefined)
  return true
}

export function createRootLayout(root: string, appId: string): RootLayout {
  const stateDir = join(root, "state")
  return {
    root,
    configDir: root,
    configFile: join(root, "lfcode.jsonc"),
    dataDir: join(root, "data"),
    stateDir,
    cacheDir: join(root, "cache"),
    userDataDir: join(stateDir, "electron", appId),
    migrationMarker: join(stateDir, "migration.json"),
  }
}

export function getBootstrapState() {
  return bootstrapState
}

export function resolveBootstrapTarget(input: BootstrapTargetInput): DesktopBootstrapState {
  if (!input.root || !input.rootKind) {
    return {
      appId: input.appId,
      appName: input.appName,
      env: {},
      mode: "legacy",
      notes: ["desktop bootstrap using legacy user directory mode"],
      userDataDir: input.legacyUserDataDir,
    }
  }

  if (!input.rootWritable) {
    return {
      appId: input.appId,
      appName: input.appName,
      env: {},
      fallbackReason: `desktop root is not writable: ${input.root}`,
      mode: "legacy",
      notes: [`desktop bootstrap falling back to legacy user directory mode: ${input.root}`],
      userDataDir: input.legacyUserDataDir,
    }
  }

  const layout = createRootLayout(input.root, input.appId)
  return {
    appId: input.appId,
    appName: input.appName,
    env: {
      LFCODE_CONFIG_DIR: layout.configDir,
      LFCODE_DATA_DIR: layout.dataDir,
      LFCODE_STATE_DIR: layout.stateDir,
      LFCODE_CACHE_DIR: layout.cacheDir,
    },
    layout,
    mode: "root",
    notes: [
      input.rootKind === "portable"
        ? `desktop bootstrap using portable root mode: ${layout.root}`
        : `desktop bootstrap using managed root mode: ${layout.root}`,
    ],
    rootKind: input.rootKind,
    userDataDir: layout.userDataDir,
  }
}

export function resolveManagedRootDirectory(input: {
  readonly homeDir?: string
  readonly isPackaged: boolean
  readonly platform: string
}) {
  if (input.platform !== "win32" || !input.isPackaged) return
  return join(input.homeDir ?? homedir(), MANAGED_ROOT_DIR)
}

function resolveInstalledWindowsRootDirectory(input: {
  readonly execPath: string
  readonly isPackaged: boolean
  readonly platform: string
}) {
  if (input.platform !== "win32" || !input.isPackaged) return
  return dirname(input.execPath)
}

export function resolveDesktopBootstrap(input: DesktopBootstrapInput) {
  const rootKind = input.portableRoot ? "portable" : "managed"
  const root = input.portableRoot ?? resolveManagedRootDirectory(input)
  return resolveBootstrapTarget({
    appId: input.appId,
    appName: input.appName,
    legacyUserDataDir: input.legacyUserDataDir,
    root,
    rootKind,
    rootWritable: root ? canWriteDirectorySync(root) : false,
  })
}

export async function prepareDesktopBootstrap(input: DesktopBootstrapInput) {
  const state = resolveDesktopBootstrap(input)
  if (state.mode !== "root" || !state.layout) {
    bootstrapState = state
    return state
  }

  await ensureRootLayout(state.layout)
  const migration = await migrateRootLayout(state.layout, {
    appId: input.appId,
    sources: getMigrationSources(input, state),
  })
  await ensureRootConfigFile(state.layout)
  const managedMcpMigrated = await upgradeManagedRootConfigFile(state.layout)
  const next = {
    ...state,
    migration,
    notes: [
      ...state.notes,
      migration.performed
        ? `desktop bootstrap root migration completed: ${migration.marker}`
        : `desktop bootstrap root migration skipped: ${migration.reason ?? "no changes"}`,
      ...(managedMcpMigrated ? ["desktop bootstrap upgraded bundled MCP configuration"] : []),
    ],
  }
  bootstrapState = next
  return next
}

export async function migrateRootLayout(
  layout: RootLayout,
  input: { readonly appId: string; readonly sources?: readonly Partial<MigrationSources>[] },
): Promise<MigrationSummary> {
  await mkdir(layout.stateDir, { recursive: true })
  const markerExists = await pathExists(layout.migrationMarker)
  if (markerExists) {
    return {
      marker: layout.migrationMarker,
      performed: false,
      reason: "marker exists",
      copied: [],
      preserved: [],
    }
  }

  const sources = input.sources?.length ? input.sources : [getLegacyMigrationSources(input.appId)]
  const copied: string[] = []
  const preserved: string[] = []

  for (const source of sources) {
    if (!source) continue
    if (source.configDir) await copyConfigDirectory(source.configDir, layout, copied, preserved)
    if (source.dataDir) await copyMissingPath(source.dataDir, layout.dataDir, copied, preserved)
    if (source.stateDir) await copyMissingPath(source.stateDir, layout.stateDir, copied, preserved)
    if (source.cacheDir) await copyMissingPath(source.cacheDir, layout.cacheDir, copied, preserved)
    if (source.userDataDir) await copyMissingPath(source.userDataDir, layout.userDataDir, copied, preserved)
  }

  await writeFile(
    layout.migrationMarker,
    JSON.stringify(
      {
        copied,
        completedAt: new Date().toISOString(),
        preserved,
        version: 1,
      },
      null,
      2,
    ),
  )

  return {
    marker: layout.migrationMarker,
    performed: true,
    copied,
    preserved,
  }
}

async function copyConfigDirectory(sourceDir: string, layout: RootLayout, copied: string[], preserved: string[]) {
  const sourceInfo = await safeStat(sourceDir)
  if (!sourceInfo?.isDirectory()) return

  const configSource = await findLegacyConfigFile(sourceDir)
  if (configSource) {
    await copyMissingPath(configSource, layout.configFile, copied, preserved)
  }

  const entries = await readdir(sourceDir)
  await Promise.all(
    entries
      .filter((entry) => !CONFIG_FILES.includes(entry as (typeof CONFIG_FILES)[number]))
      .map((entry) => copyMissingPath(join(sourceDir, entry), join(layout.root, entry), copied, preserved)),
  )
}

async function copyMissingPath(source: string, target: string, copied: string[], preserved: string[]) {
  const sourceInfo = await safeStat(source)
  if (!sourceInfo) return

  const targetInfo = await safeStat(target)
  if (sourceInfo.isDirectory()) {
    if (targetInfo && !targetInfo.isDirectory()) {
      preserved.push(target)
      return
    }
    await mkdir(target, { recursive: true })
    const entries = await readdir(source)
    await Promise.all(entries.map((entry) => copyMissingPath(join(source, entry), join(target, entry), copied, preserved)))
    return
  }

  if (targetInfo) {
    preserved.push(target)
    return
  }

  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  copied.push(target)
}

async function ensureRootLayout(layout: RootLayout) {
  await Promise.all([
    mkdir(layout.dataDir, { recursive: true }),
    mkdir(layout.stateDir, { recursive: true }),
    mkdir(layout.cacheDir, { recursive: true }),
    mkdir(layout.userDataDir, { recursive: true }),
  ])
}

async function ensureRootConfigFile(layout: RootLayout) {
  if (await pathExists(layout.configFile)) return
  await writeFile(layout.configFile, `${JSON.stringify(DEFAULT_ROOT_CONFIG, null, 2)}\n`)
}

async function upgradeManagedRootConfigFile(layout: RootLayout) {
  const text = await readFile(layout.configFile, "utf8").catch(() => undefined)
  if (!text) return false

  const parsed = parseJsonc(text)
  if (!isRecord(parsed)) return false
  if (!isRecord(parsed.mcp)) return false

  let updated = text
  let changed = false
  const playwright = parsed.mcp.playwright
  if (isLegacyPlaywrightConfig(playwright)) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp", "playwright"], DEFAULT_ROOT_CONFIG.mcp.playwright, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    changed = true
  }

  if (
    (isPlaywrightCdpConfig(playwright) || isLegacyPlaywrightConfig(playwright)) &&
    parsed.mcp["windows-computer-use"] === undefined
  ) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp", "windows-computer-use"], DEFAULT_ROOT_CONFIG.mcp["windows-computer-use"], {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    changed = true
  }

  const windowsComputerUse = parsed.mcp["windows-computer-use"]
  if (isLegacyWindowsComputerUseConfig(windowsComputerUse)) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp", "windows-computer-use"], DEFAULT_ROOT_CONFIG.mcp["windows-computer-use"], {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    changed = true
  }

  if (!changed) return false
  await writeFile(layout.configFile, updated)
  return true
}

function ensureRootLayoutSync(layout: RootLayout) {
  mkdirSync(layout.dataDir, { recursive: true })
  mkdirSync(layout.stateDir, { recursive: true })
  mkdirSync(layout.cacheDir, { recursive: true })
  mkdirSync(layout.userDataDir, { recursive: true })
}

async function findLegacyConfigFile(directory: string) {
  for (const name of CONFIG_FILES) {
    const file = join(directory, name)
    if (await pathExists(file)) return file
  }
}

function getLegacyMigrationSources(appId: string, home = homedir(), appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")): MigrationSources {
  return {
    configDir: join(home, ".config", "lfcode"),
    dataDir: join(home, ".local", "share", "lfcode"),
    stateDir: join(home, ".local", "state", "lfcode"),
    cacheDir: join(home, ".cache", "lfcode"),
    userDataDir: join(appData, appId),
  }
}

function getMigrationSources(input: DesktopBootstrapInput, state: DesktopBootstrapState) {
  const defaults = input.migrationSources?.length
    ? input.migrationSources
    : [getLegacyMigrationSources(input.appId, input.homeDir, input.homeDir ? join(input.homeDir, "AppData", "Roaming") : undefined)]
  if (state.mode !== "root" || !state.layout) return [...defaults]
  if (state.rootKind !== "managed") return [...defaults]

  const installedRoot = resolveInstalledWindowsRootDirectory(input)
  const priorRoot =
    installedRoot && installedRoot !== state.layout.root ? createRootLayout(installedRoot, input.appId) : undefined
  const priorRootSource = priorRoot
    ? {
        configDir: priorRoot.configDir,
        dataDir: priorRoot.dataDir,
        stateDir: priorRoot.stateDir,
        cacheDir: priorRoot.cacheDir,
        userDataDir: priorRoot.userDataDir,
      }
    : undefined
  return [priorRootSource, ...defaults].filter(
    (source): source is Partial<MigrationSources> => !!source,
  )
}

function canWriteDirectorySync(directory: string) {
  const probe = join(resolveProbeDirectory(directory), `.lfcode-write-test-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(probe, "")
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => key in value)
}

function isStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
}

function isLegacyPlaywrightConfig(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, PLAYWRIGHT_MCP_KEYS)) return false
  if (value.type !== "local") return false
  if (value.enabled !== true) return false
  return isStringArray(value.command, [...PLAYWRIGHT_MCP_LEGACY_COMMAND])
}

function isPlaywrightCdpConfig(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, PLAYWRIGHT_MCP_KEYS)) return false
  if (value.type !== "local") return false
  if (value.enabled !== true) return false
  return isStringArray(value.command, [...PLAYWRIGHT_MCP_CDP_COMMAND])
}

function isLegacyWindowsComputerUseConfig(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, WINDOWS_COMPUTER_USE_MCP_KEYS)) return false
  if (value.type !== "local") return false
  if (value.enabled !== true) return false
  return (
    isStringArray(value.command, [...WINDOWS_COMPUTER_USE_MCP_LEGACY_COMMAND]) ||
    isBrokenWindowsComputerUseCommand(value.command)
  )
}

function isBrokenWindowsComputerUseCommand(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false
  if (value[0] !== "cmd" || value[1] !== "/c" || value[2] !== "node") return false
  if (typeof value[3] !== "string") return false
  const target = value[3].replace(/^"+|"+$/g, "").replaceAll("\\", "/").toLowerCase()
  return (
    target === "{env:lfcode_windows_computer_use_mcp_dir}/bundle/index.js" ||
    (target.includes("windows-computer-use-mcp") && target.endsWith("/bundle/index.js"))
  )
}

function resolveProbeDirectory(directory: string) {
  let current = directory
  while (true) {
    try {
      if (statSync(current).isDirectory()) return current
    } catch {}
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

function pathExists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}

function safeStat(path: string) {
  return stat(path).then(
    (info) => info,
    () => undefined,
  )
}
