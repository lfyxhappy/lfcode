import { accessSync, copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { copyFile, readFile } from "node:fs/promises"
import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import type { App } from "electron"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const LFCODE_CONFIG_FILES = [
  "lfcode.jsonc",
  "lfcode.json",
  "config.json",
] as const
const ROOT_CONFIG_ARTIFACTS = ["tui.json"] as const
const MANAGED_ROOT_DIR = ".lfcode"
const require = createRequire(import.meta.url)
const PLAYWRIGHT_MCP_COMMAND = ["cmd", "/c", "npx", "-y", "@playwright/mcp@0.0.73"] as const
const PLAYWRIGHT_MCP_CDP_COMMAND = [...PLAYWRIGHT_MCP_COMMAND, "--cdp-endpoint=http://127.0.0.1:9222"] as const
const PLAYWRIGHT_MCP_LEGACY_COMMAND = [...PLAYWRIGHT_MCP_COMMAND, "--browser", "chrome"] as const
const PLAYWRIGHT_MCP_REMOTE_URL = "{env:LFCODE_SERVER_URL}/global/mcp/playwright"
const PLAYWRIGHT_MCP_REMOTE_HEADERS = {
  authorization: "{env:LFCODE_SERVER_AUTH}",
} as const
const WINDOWS_COMPUTER_USE_MCP_LEGACY_COMMAND = [
  "cmd",
  "/c",
  "node",
  "\"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js\"",
] as const
const WINDOWS_COMPUTER_USE_MCP_PREVIOUS_COMMAND = ["node", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"] as const
const WINDOWS_COMPUTER_USE_MCP_COMMAND = [
  "{env:LFCODE_BUNDLED_NODE}",
  "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js",
] as const
const WINDOWS_COMPUTER_USE_MCP_ENVIRONMENT = {
  ELECTRON_RUN_AS_NODE: "1",
} as const
const PLAYWRIGHT_MCP_KEYS = ["type", "command", "enabled"] as const
const PLAYWRIGHT_MCP_REMOTE_KEYS = ["type", "url", "headers", "enabled"] as const
const WINDOWS_COMPUTER_USE_MCP_KEYS = ["type", "command", "enabled"] as const
const BUNDLED_MCP_MIGRATION_VERSION = 3
const DEFAULT_LSP_MIGRATION_VERSION = 1

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
  readonly codegraph: CodegraphBootstrap
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
  readonly arch?: string
  readonly codegraphMode?: "bundled" | "shim" | "external"
  readonly execPath: string
  readonly homeDir?: string
  readonly isPackaged: boolean
  readonly legacyUserDataDir: string
  readonly legacyUserDataOverride?: string
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

type CodegraphBootstrap = {
  readonly kind: "bundled" | "shim" | "external"
  readonly entry?: string
  readonly nodePath?: string
  readonly platformDir?: string
}

function defaultRootConfig() {
  return {
    $schema: "https://lfcode.ai/config.json",
    lsp: true,
    mcp: {
      playwright: {
        type: "remote",
        url: PLAYWRIGHT_MCP_REMOTE_URL,
        headers: PLAYWRIGHT_MCP_REMOTE_HEADERS,
        enabled: true,
      },
      "windows-computer-use": {
        type: "local",
        command: WINDOWS_COMPUTER_USE_MCP_COMMAND,
        environment: WINDOWS_COMPUTER_USE_MCP_ENVIRONMENT,
        enabled: true,
      },
    },
  } as const
}

export function applyBootstrapState(app: App, state: DesktopBootstrapState) {
  app.setName(state.appName)
  app.setAppUserModelId(state.appId)
  if (state.layout) ensureRootLayoutSync(state.layout)
  process.env.LFCODE_BUNDLED_NODE = process.execPath.replaceAll("\\", "/")
  delete process.env.LFCODE_CODEGRAPH_NODE_EXE
  delete process.env.LFCODE_CODEGRAPH_ENTRY
  delete process.env.LFCODE_CODEGRAPH_NODE_PATH
  delete process.env.LFCODE_CODEGRAPH_RUN_AS_NODE
  delete process.env.LFCODE_CODEGRAPH_INSTALL_DIR
  delete process.env.LFCODE_GIT_PATH
  delete process.env.LFCODE_GIT_SSH_PATH
  delete process.env.LFCODE_GIT_LESS_PATH
  process.env.LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR = app.isPackaged
    ? join(process.resourcesPath, "mcp", "windows-computer-use-mcp").replaceAll("\\", "/")
    : join(app.getAppPath(), "../../.windows-computer-use-mcp").replaceAll("\\", "/")
  if (process.platform === "win32") {
    const managedPythonRoot = state.layout ? join(state.layout.dataDir, "python", "runtime") : undefined
    const managedPythonPath = managedPythonRoot ? join(managedPythonRoot, "Scripts", "python.exe").replaceAll("\\", "/") : ""
    const managedScriptsPath = managedPythonRoot ? join(managedPythonRoot, "Scripts").replaceAll("\\", "/") : ""
    const bundledGitRoot = app.isPackaged ? join(process.resourcesPath, "git") : ""
    const bundledGitCmdPath = bundledGitRoot ? join(bundledGitRoot, "cmd").replaceAll("\\", "/") : ""
    const bundledGitUsrBinPath = bundledGitRoot ? join(bundledGitRoot, "usr", "bin").replaceAll("\\", "/") : ""
    const bundledGitMingwBinPath = bundledGitRoot ? join(bundledGitRoot, "mingw64", "bin").replaceAll("\\", "/") : ""
    const bundledGitPath =
      bundledGitRoot && pathExistsSync(join(bundledGitRoot, "cmd", "git.exe"))
        ? join(bundledGitRoot, "cmd", "git.exe").replaceAll("\\", "/")
        : bundledGitRoot && pathExistsSync(join(bundledGitRoot, "mingw64", "bin", "git.exe"))
          ? join(bundledGitRoot, "mingw64", "bin", "git.exe").replaceAll("\\", "/")
          : ""
    process.env.LFCODE_PWSH_PATH = app.isPackaged
      ? join(process.resourcesPath, "pwsh", "pwsh.exe").replaceAll("\\", "/")
      : ""
    process.env.LFCODE_GIT_PATH = bundledGitPath
    process.env.LFCODE_GIT_SSH_PATH = bundledGitRoot
      ? join(bundledGitRoot, "usr", "bin", "ssh.exe").replaceAll("\\", "/")
      : ""
    process.env.LFCODE_GIT_LESS_PATH = bundledGitRoot
      ? join(bundledGitRoot, "usr", "bin", "less.exe").replaceAll("\\", "/")
      : ""
    process.env.LFCODE_MANAGED_PYTHON_PATH = managedPythonPath
    const pythonPath = app.isPackaged ? join(process.resourcesPath, "python", "python.exe").replaceAll("\\", "/") : ""
    process.env.LFCODE_PYTHON_PATH = pythonPath
    prependPath([bundledGitCmdPath, bundledGitUsrBinPath, bundledGitMingwBinPath, managedScriptsPath])
    if (pythonPath) prependPath([dirname(pythonPath), join(dirname(pythonPath), "Scripts").replaceAll("\\", "/")])
  }
  for (const [key, value] of Object.entries(state.env)) {
    if (!value) continue
    process.env[key] = value
  }
  app.setPath("userData", state.userDataDir)
}

function prependPath(entries: string[]) {
  const next = entries.filter(Boolean)
  if (next.length === 0) return
  const key = resolvePathKey()
  const current = (process.env[key] ?? "").split(delimiter).filter(Boolean)
  const merged = [...next, ...current].filter(
    (value, index, list) =>
      list.findIndex((item) =>
        process.platform === "win32" ? item.toLowerCase() === value.toLowerCase() : item === value,
      ) === index,
  )
  process.env[key] = merged.join(delimiter)
  if (key !== "PATH") process.env.PATH = process.env[key]
}

function resolvePathKey() {
  if (process.platform !== "win32") return "PATH"
  return Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "Path"
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
      codegraph: { kind: "external" },
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
      codegraph: { kind: "external" },
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
    codegraph: { kind: "external" },
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
  const target = resolveBootstrapTarget({
    appId: input.appId,
    appName: input.appName,
    legacyUserDataDir: input.legacyUserDataOverride ?? input.legacyUserDataDir,
    root,
    rootKind,
    rootWritable: root ? canWriteDirectorySync(root) : false,
  })
  const next: DesktopBootstrapState = {
    ...target,
    notes: [...target.notes, "desktop bootstrap codegraph disabled"],
    codegraph: { kind: "external" },
  }
  return next
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
  await compactMigrationMarker(state.layout)
  await ensureRootConfigFile(state.layout)
  const managedMcpMigrated = await upgradeManagedRootConfigFile(state.layout)
  const next: DesktopBootstrapState = {
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
        copiedEntries: copied.length,
        completedAt: new Date().toISOString(),
        preservedEntries: preserved.length,
        scope: "lfcode-root-layout",
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

  const configSource = await findConfigForOneTimeMigration(sourceDir)
  if (configSource) {
    await copyMissingPath(configSource, layout.configFile, copied, preserved)
  }

  const entries = await readdir(sourceDir)
  await Promise.all(
    entries
      .filter(shouldCopyConfigArtifact)
      .map((entry) => copyMissingPath(join(sourceDir, entry), join(layout.root, entry), copied, preserved)),
  )
}

function shouldCopyConfigArtifact(entry: string) {
  if (LFCODE_CONFIG_FILES.includes(entry as (typeof LFCODE_CONFIG_FILES)[number])) return false
  if (ROOT_CONFIG_ARTIFACTS.includes(entry as (typeof ROOT_CONFIG_ARTIFACTS)[number])) return true
  return !entry.endsWith(".json") && !entry.endsWith(".jsonc")
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
  const current = await findLfcodeConfigFile(layout.root)
  if (current && current !== layout.configFile) {
    await copyFile(current, layout.configFile)
    return
  }
  await writeFile(layout.configFile, `${JSON.stringify(defaultRootConfig(), null, 2)}\n`)
}

async function compactMigrationMarker(layout: RootLayout) {
  const marker = await readMigrationMarker(layout)
  if (!marker) return
  if (!Array.isArray(marker.copied) && !Array.isArray(marker.preserved) && marker.deprecatedConfigMigrationVersion === undefined) return

  const { copied, deprecatedConfigMigrationVersion, preserved, ...current } = marker
  await writeFile(
    layout.migrationMarker,
    JSON.stringify(
      {
        ...current,
        copiedEntries: Array.isArray(copied) ? copied.length : current.copiedEntries,
        preservedEntries: Array.isArray(preserved) ? preserved.length : current.preservedEntries,
        scope: "lfcode-root-layout",
      },
      null,
      2,
    ),
  )
}

async function upgradeManagedRootConfigFile(layout: RootLayout) {
  const text = await readFile(layout.configFile, "utf8").catch(() => undefined)
  if (!text) return false

  const marker = await readMigrationMarker(layout)
  const bundledMcpVersion = typeof marker?.bundledMcpVersion === "number" ? marker.bundledMcpVersion : 0
  const bundledMcpMigrationPending = bundledMcpVersion < BUNDLED_MCP_MIGRATION_VERSION
  const lspVersion = typeof marker?.defaultLspVersion === "number" ? marker.defaultLspVersion : 0
  const defaultLspMigrationPending = lspVersion < DEFAULT_LSP_MIGRATION_VERSION
  const parsed = parseJsonc(text)
  if (!isRecord(parsed)) return false

  let updated = text
  let changed = false
  const mcp = isRecord(parsed.mcp) ? parsed.mcp : undefined

  if (defaultLspMigrationPending && parsed.lsp === undefined) {
    updated = applyEdits(
      updated,
      modify(updated, ["lsp"], true, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    changed = true
  }

  if (bundledMcpMigrationPending && !mcp) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp"], defaultRootConfig().mcp, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
    changed = true
  }

  if (mcp) {
    const playwright = mcp.playwright
    if (
      isLegacyPlaywrightConfig(playwright) ||
      isPlaywrightCdpConfig(playwright) ||
      isStaleBundledPlaywrightRemoteConfig(playwright) ||
      (bundledMcpMigrationPending && playwright === undefined)
    ) {
      updated = applyEdits(
        updated,
        modify(updated, ["mcp", "playwright"], defaultRootConfig().mcp.playwright, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        }),
      )
      changed = true
    }

    const windowsComputerUse = mcp["windows-computer-use"]
    if (
      isLegacyWindowsComputerUseConfig(windowsComputerUse) ||
      (bundledMcpMigrationPending && windowsComputerUse === undefined)
    ) {
      updated = applyEdits(
        updated,
        modify(updated, ["mcp", "windows-computer-use"], defaultRootConfig().mcp["windows-computer-use"], {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        }),
      )
      changed = true
    }
  }

  if (changed) await writeFile(layout.configFile, updated)
  if (bundledMcpMigrationPending) {
    await writeMigrationMarker(layout, {
      bundledMcpVersion: BUNDLED_MCP_MIGRATION_VERSION,
    })
  }
  if (defaultLspMigrationPending) {
    await writeMigrationMarker(layout, {
      defaultLspVersion: DEFAULT_LSP_MIGRATION_VERSION,
    })
  }

  if (!changed) return false
  return true
}

function ensureRootLayoutSync(layout: RootLayout) {
  mkdirSync(layout.dataDir, { recursive: true })
  mkdirSync(layout.stateDir, { recursive: true })
  mkdirSync(layout.cacheDir, { recursive: true })
  mkdirSync(layout.userDataDir, { recursive: true })
}

async function findLfcodeConfigFile(directory: string) {
  for (const name of LFCODE_CONFIG_FILES) {
    const file = join(directory, name)
    if (await pathExists(file)) return file
  }
}

async function findConfigForOneTimeMigration(directory: string) {
  return findLfcodeConfigFile(directory)
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

function isStaleBundledPlaywrightRemoteConfig(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, PLAYWRIGHT_MCP_REMOTE_KEYS)) return false
  if (value.type !== "remote") return false
  if (value.enabled !== true) return false
  if (typeof value.url !== "string" || !isLoopbackPlaywrightRemoteUrl(value.url)) return false
  if (!isRecord(value.headers)) return false
  if (Object.keys(value.headers).length !== 1) return false
  return typeof value.headers.authorization === "string"
}

function isLoopbackPlaywrightRemoteUrl(value: string) {
  return (
    (value.startsWith("http://127.0.0.1:") || value.startsWith("http://localhost:")) &&
    value.endsWith("/global/mcp/playwright")
  )
}

function isLegacyWindowsComputerUseConfig(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, WINDOWS_COMPUTER_USE_MCP_KEYS)) return false
  if (value.type !== "local") return false
  if (value.enabled !== true) return false
  return (
    isStringArray(value.command, [...WINDOWS_COMPUTER_USE_MCP_PREVIOUS_COMMAND]) ||
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

function pathExistsSync(file: string) {
  try {
    accessSync(file)
    return true
  } catch {
    return false
  }
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

async function readMigrationMarker(layout: RootLayout) {
  const text = await readFile(layout.migrationMarker, "utf8").catch(() => undefined)
  if (!text) return
  const parsed = parseJsonc(text)
  return isRecord(parsed) ? parsed : undefined
}

async function writeMigrationMarker(layout: RootLayout, patch: Record<string, unknown>) {
  const current = (await readMigrationMarker(layout)) ?? {}
  await writeFile(
    layout.migrationMarker,
    JSON.stringify(
      {
        ...current,
        ...patch,
      },
      null,
      2,
    ),
  )
}
