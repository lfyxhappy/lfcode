import { accessSync, copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { copyFile } from "node:fs/promises"
import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { App } from "electron"

const CONFIG_FILES = ["lfcode.jsonc", "lfcode.json", "config.json"] as const
const MANAGED_ROOT_DIR = ".lfcode"

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
  const next = {
    ...state,
    migration,
    notes: [
      ...state.notes,
      migration.performed
        ? `desktop bootstrap root migration completed: ${migration.marker}`
        : `desktop bootstrap root migration skipped: ${migration.reason ?? "no changes"}`,
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
  await writeFile(
    layout.configFile,
    `${JSON.stringify(
      {
        $schema: "https://lfcode.ai/config.json",
      },
      null,
      2,
    )}\n`,
  )
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
