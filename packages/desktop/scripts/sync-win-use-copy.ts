#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { copyFile, link, lstat, mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const distDir = path.resolve(import.meta.dir, "../dist")
const sourceDir = path.join(distDir, "win-unpacked")
const targetDir = path.resolve(Bun.env.LFCODE_USE_COPY_DIR ?? "C:\\算法\\小应用\\Lfcode")
const executableName = Bun.env.LFCODE_EXECUTABLE_NAME ?? "Lfcode.exe"
const dataMigrationSource = Bun.env.LFCODE_DATA_MIGRATION_SOURCE
const dataMigrationTarget = Bun.env.LFCODE_DATA_MIGRATION_TARGET
const targetParent = path.dirname(targetDir)
const targetName = path.basename(targetDir)
const stagingDir = path.join(targetParent, `.${targetName}.sync-${process.pid}`)
const backupDir = path.join(targetParent, `.${targetName}.previous-${process.pid}`)
const skippedEntries = new Set([
  "cache",
  "config",
  "config.json",
  "data",
  "lfcode.json",
  "lfcode.jsonc",
  "node_modules",
  "state",
])
const protectedRootEntries = new Set([...skippedEntries, "Lfcode.exe", "LfcodePre.exe", "resources"])
const protectedResourceEntries = new Set(["app.asar", "app.asar.unpacked", "cli"])
const playwrightBaseCommand = ["cmd", "/c", "npx", "-y", "@playwright/mcp@0.0.73"] as const
const playwrightLegacyCommand = [...playwrightBaseCommand, "--browser", "chrome"] as const
const playwrightCdpCommand = [...playwrightBaseCommand, "--cdp-endpoint=http://127.0.0.1:9222"] as const
const playwrightRemoteConfig = {
  type: "remote",
  url: "{env:LFCODE_SERVER_URL}/global/mcp/playwright",
  headers: {
    authorization: "{env:LFCODE_SERVER_AUTH}",
  },
  enabled: true,
} as const
const windowsComputerUseLegacyCommand = [
  "cmd",
  "/c",
  "node",
  '"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js"',
] as const
const windowsComputerUsePreviousCommand = ["node", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"] as const
const windowsComputerUseCommand = [
  "{env:LFCODE_BUNDLED_NODE}",
  "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js",
] as const
const windowsComputerUseConfig = {
  type: "local",
  command: windowsComputerUseCommand,
  environment: {
    ELECTRON_RUN_AS_NODE: "1",
  },
  enabled: true,
} as const

async function copyDirectoryContents(source: string, target: string) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await copyEntry(path.join(source, entry.name), path.join(target, entry.name), entry.isDirectory())
  }
}

async function copyEntry(source: string, target: string, directory: boolean) {
  if (directory) {
    await copyDirectoryContents(source, target)
    return
  }
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
}

async function linkEntry(source: string, target: string, directory: boolean) {
  if (directory) {
    await mkdir(target, { recursive: true })
    await Promise.all(
      (await readdir(source, { withFileTypes: true })).map((entry) =>
        linkEntry(path.join(source, entry.name), path.join(target, entry.name), entry.isDirectory()),
      ),
    )
    return
  }
  await mkdir(path.dirname(target), { recursive: true })
  await link(source, target).catch(() => copyFile(source, target))
}

async function reusablePayloadEntries() {
  const rootEntries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => !protectedRootEntries.has(entry.name))
    .map((entry) => ({ relativePath: entry.name, directory: entry.isDirectory() }))
  const resourceEntries = (await readdir(path.join(sourceDir, "resources"), { withFileTypes: true }))
    .filter((entry) => !protectedResourceEntries.has(entry.name))
    .map((entry) => ({ relativePath: path.join("resources", entry.name), directory: entry.isDirectory() }))
  return [...rootEntries, ...resourceEntries]
}

async function fingerprintReusablePayload(entries: Awaited<ReturnType<typeof reusablePayloadEntries>>) {
  const hash = createHash("sha256")
  const files = (
    await Promise.all(
      entries.map((entry) => listFiles(path.join(sourceDir, entry.relativePath), entry.relativePath, entry.directory)),
    )
  )
    .flat()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const details = await Promise.all(files.map((file) => lstat(file.path)))
  for (const [index, file] of files.entries()) {
    const detail = details[index]
    hash.update(file.relativePath)
    hash.update("\0")
    hash.update(`${detail.size}:${detail.mtimeMs}`)
  }
  return hash.digest("hex")
}

async function listFiles(file: string, relativePath: string, directory: boolean): Promise<{ path: string; relativePath: string }[]> {
  if (!directory) return [{ path: file, relativePath }]
  return (
    await Promise.all(
      (await readdir(file, { withFileTypes: true })).map((entry) =>
        listFiles(path.join(file, entry.name), path.join(relativePath, entry.name), entry.isDirectory()),
      ),
    )
  ).flat()
}

async function upgradeBundledConfig(target: string) {
  if (!existsSync(target)) return
  const text = await Bun.file(target).text()
  const upgraded = upgradeBundledCommands(text)
  if (upgraded !== text) await Bun.write(target, upgraded)
}

async function readBuildHashes(directory: string) {
  return {
    executableSha256: await sha256File(path.join(directory, executableName)),
    appAsarSha256: await sha256File(path.join(directory, "resources", "app.asar")),
  }
}

async function assertLaneIcon() {
  const expected = executableName === "LfcodePre.exe" ? "dev" : "prod"
  const expectedIcon = path.resolve(import.meta.dir, "..", "icons", expected, "icon.ico")
  const packagedIcon = path.join(sourceDir, "resources", "icons", "icon.ico")
  if (!existsSync(packagedIcon)) throw new Error(`Packaged Windows app is missing its ${expected} lane icon: ${packagedIcon}`)
  if ((await sha256File(packagedIcon)) === (await sha256File(expectedIcon))) return
  throw new Error(
    `Refusing to sync ${executableName}: packaged icon does not match the ${expected} lane. Repackage the correct lane before syncing.`,
  )
}

async function assertBuildHashes(directory: string, expected: Awaited<ReturnType<typeof readBuildHashes>>) {
  const actual = await readBuildHashes(directory)
  if (actual.executableSha256 !== expected.executableSha256) {
    throw new Error(`Synced file hash mismatch: ${path.join(directory, executableName)}`)
  }
  if (actual.appAsarSha256 !== expected.appAsarSha256) {
    throw new Error(`Synced file hash mismatch: ${path.join(directory, "resources", "app.asar")}`)
  }
}

async function readUseCopyManifest() {
  const manifestPath = path.join(targetDir, ".lfcode-build.json")
  if (!existsSync(manifestPath)) return undefined
  const manifest = await Bun.file(manifestPath).json().catch(() => undefined)
  return isRecord(manifest) ? manifest : undefined
}

async function isCurrentUseCopy(expected: Awaited<ReturnType<typeof readBuildHashes>>, manifest: Record<string, unknown> | undefined) {
  if (!manifest || manifest.syncSchema !== 4) return false
  if (manifest.executableSha256 !== expected.executableSha256 || manifest.appAsarSha256 !== expected.appAsarSha256) {
    return false
  }
  if (!existsSync(path.join(targetDir, executableName)) || !existsSync(path.join(targetDir, "resources", "app.asar"))) {
    return false
  }
  await upgradeBundledConfig(path.join(targetDir, "lfcode.jsonc"))
  return true
}

async function copyPackagedFiles(reusedEntries: Awaited<ReturnType<typeof reusablePayloadEntries>>) {
  const skippedDirectories = ["cache", "config", "data", "node_modules", "state"]
  const skippedFiles = ["config.json", "lfcode.json", "lfcode.jsonc"]
  const copyProcess = Bun.spawn(
    [
      "robocopy",
      sourceDir,
      stagingDir,
      "/E",
      "/COPY:DAT",
      "/DCOPY:DAT",
      "/R:1",
      "/W:1",
      "/MT:32",
      "/XJ",
      "/NFL",
      "/NDL",
      "/NP",
      "/NJH",
      "/NJS",
      ...skippedDirectories.flatMap((name) => ["/XD", path.join(sourceDir, name)]),
      ...skippedFiles.flatMap((name) => ["/XF", path.join(sourceDir, name)]),
      ...reusedEntries.flatMap((entry) =>
        entry.directory ? ["/XD", path.join(sourceDir, entry.relativePath)] : ["/XF", path.join(sourceDir, entry.relativePath)],
      ),
    ],
    { stdout: "ignore", stderr: "pipe" },
  )
  const exitCode = await copyProcess.exited
  if (exitCode <= 7) return
  const details = await new Response(copyProcess.stderr).text()
  throw new Error(`robocopy failed with exit code ${exitCode}: ${details.trim()}`)
}

async function syncUseCopy(
  sourceHashes: Awaited<ReturnType<typeof readBuildHashes>>,
  reusableEntries: Awaited<ReturnType<typeof reusablePayloadEntries>>,
  reusablePayloadFingerprint: string,
) {
  await rm(stagingDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    for (const entry of reusableEntries) {
      await linkEntry(path.join(targetDir, entry.relativePath), path.join(stagingDir, entry.relativePath), entry.directory)
    }
    await copyPackagedFiles(reusableEntries)

    // Runtime state is carried forward explicitly into the staged copy. Since
    // the staged directory starts empty, removed package files cannot survive.
    for (const name of skippedEntries) {
      const existing = path.join(targetDir, name)
      if (existsSync(existing)) {
        const info = await lstat(existing)
        await copyEntry(existing, path.join(stagingDir, name), info.isDirectory())
        continue
      }
      const packaged = path.join(sourceDir, name)
      if (existsSync(packaged)) {
        const info = await lstat(packaged)
        await copyEntry(packaged, path.join(stagingDir, name), info.isDirectory())
      }
    }

    await writeBuildManifest(stagingDir, sourceHashes, reusablePayloadFingerprint)

    let switched = false
    try {
      if (existsSync(targetDir)) await rename(targetDir, backupDir)
      await rename(stagingDir, targetDir)
      switched = true
      await upgradeBundledConfig(path.join(targetDir, "lfcode.jsonc"))
      await assertBuildHashes(targetDir, sourceHashes)
      // Windows can retain a handle to the retired directory after every
      // payload file has been switched. The new copy is already verified; do
      // not roll it back merely because deferred backup cleanup is locked.
      await rm(backupDir, { recursive: true, force: true }).catch((error) => {
        console.warn(`Synced app, but could not remove retired copy ${backupDir}: ${String(error)}`)
      })
      console.log(`Synced packaged Windows app atomically from ${sourceDir} to ${targetDir}`)
    } catch (error) {
      if (switched) {
        await rm(targetDir, { recursive: true, force: true })
      }
      if (!existsSync(targetDir) && existsSync(backupDir)) await rename(backupDir, targetDir)
      throw new Error(
        `Unable to complete the use-copy switch. Close ${executableName} and retry: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

if (process.platform !== "win32") process.exit(0)
if (!existsSync(sourceDir)) throw new Error(`Packaged Windows app not found: ${sourceDir}`)
await assertLaneIcon()

const sourceHashes = await readBuildHashes(sourceDir)
const useCopyManifest = await readUseCopyManifest()
if (await isCurrentUseCopy(sourceHashes, useCopyManifest)) {
  console.log(`Use-copy already matches packaged build for ${targetDir}`)
} else {
  const payloadEntries = await reusablePayloadEntries()
  const reusablePayloadFingerprint = await fingerprintReusablePayload(payloadEntries)
  const reusableEntries =
    useCopyManifest?.syncSchema === 4 && useCopyManifest.reusablePayloadFingerprint === reusablePayloadFingerprint
      ? payloadEntries.filter((entry) => existsSync(path.join(targetDir, entry.relativePath)))
      : []
  if (reusableEntries.length !== 0 && reusableEntries.length !== payloadEntries.length) {
    await syncUseCopy(sourceHashes, [], reusablePayloadFingerprint)
  } else {
    await syncUseCopy(sourceHashes, reusableEntries, reusablePayloadFingerprint)
  }
}

if (dataMigrationSource && dataMigrationTarget) {
  const copied = await copyMissingData(path.resolve(dataMigrationSource), path.resolve(dataMigrationTarget))
  console.log(`Copied ${copied} missing data entries from ${dataMigrationSource} to ${dataMigrationTarget}`)
}

async function copyMissingData(source: string, target: string): Promise<number> {
  if (source === target) throw new Error("Data migration source and target must be different")
  const sourceInfo = await lstat(source).catch(() => undefined)
  if (!sourceInfo?.isDirectory()) return 0

  const targetInfo = await lstat(target).catch(() => undefined)
  if (targetInfo && !targetInfo.isDirectory()) return 0
  await mkdir(target, { recursive: true })

  const copied = await Promise.all(
    (await readdir(source, { withFileTypes: true })).map(async (entry) => {
      const sourceEntry = path.join(source, entry.name)
      const targetEntry = path.join(target, entry.name)
      const targetEntryInfo = await lstat(targetEntry).catch(() => undefined)
      if (entry.isDirectory()) {
        if (targetEntryInfo && !targetEntryInfo.isDirectory()) return 0
        return copyMissingData(sourceEntry, targetEntry)
      }
      if (targetEntryInfo) return 0
      await mkdir(path.dirname(targetEntry), { recursive: true })
      await copyFile(sourceEntry, targetEntry)
      return 1
    }),
  )
  return copied.reduce((total, count) => total + count, 0)
}

async function writeBuildManifest(
  directory: string,
  hashes: Awaited<ReturnType<typeof readBuildHashes>>,
  reusablePayloadFingerprint: string,
) {
  const packageJson = await Bun.file(path.join(import.meta.dir, "..", "package.json")).json()
  await Bun.write(
    path.join(directory, ".lfcode-build.json"),
    `${JSON.stringify(
      {
        syncSchema: 4,
        version: packageJson.version,
        executableName,
        buildID: `${hashes.executableSha256.slice(0, 16)}-${hashes.appAsarSha256.slice(0, 16)}`,
        executableSha256: hashes.executableSha256,
        appAsarSha256: hashes.appAsarSha256,
        reusablePayloadFingerprint,
        packagedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
}

async function sha256File(file: string) {
  const hash = createHash("sha256")
  hash.update(Buffer.from(await Bun.file(file).arrayBuffer()))
  return hash.digest("hex")
}

function upgradeBundledCommands(text: string) {
  const parsed = parseJsonc(text)
  if (!isRecord(parsed)) return text
  let updated = text
  const mcp = isRecord(parsed.mcp) ? parsed.mcp : undefined
  if (!mcp) {
    return applyEdits(
      updated,
      modify(
        updated,
        ["mcp"],
        { playwright: playwrightRemoteConfig, "windows-computer-use": windowsComputerUseConfig },
        {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        },
      ),
    )
  }
  const playwright = mcp.playwright
  if (
    isLegacyPlaywrightConfig(playwright) ||
    isPlaywrightCdpConfig(playwright) ||
    isStaleBundledPlaywrightRemoteConfig(playwright)
  ) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp", "playwright"], playwrightRemoteConfig, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
  }
  const windowsComputerUse = mcp["windows-computer-use"]
  if (windowsComputerUse === undefined || isLegacyWindowsComputerUseConfig(windowsComputerUse)) {
    updated = applyEdits(
      updated,
      modify(updated, ["mcp", "windows-computer-use"], windowsComputerUseConfig, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
  }
  return updated
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isExactCommand(value: unknown, expected: readonly string[]) {
  return (
    Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
  )
}

function isLegacyPlaywrightConfig(value: unknown) {
  return (
    isRecord(value) &&
    value.type === "local" &&
    value.enabled === true &&
    isExactCommand(value.command, playwrightLegacyCommand)
  )
}

function isPlaywrightCdpConfig(value: unknown) {
  return (
    isRecord(value) &&
    value.type === "local" &&
    value.enabled === true &&
    isExactCommand(value.command, playwrightCdpCommand)
  )
}

function isStaleBundledPlaywrightRemoteConfig(value: unknown) {
  if (!isRecord(value)) return false
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
  return (
    isRecord(value) &&
    value.type === "local" &&
    value.enabled === true &&
    (isExactCommand(value.command, windowsComputerUsePreviousCommand) ||
      isExactCommand(value.command, windowsComputerUseLegacyCommand) ||
      isBrokenWindowsComputerUseCommand(value.command))
  )
}

function isBrokenWindowsComputerUseCommand(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false
  if (value[0] !== "cmd" || value[1] !== "/c" || value[2] !== "node") return false
  if (typeof value[3] !== "string") return false
  const target = value[3]
    .replace(/^"+|"+$/g, "")
    .replaceAll("\\", "/")
    .toLowerCase()
  return (
    target === "{env:lfcode_windows_computer_use_mcp_dir}/bundle/index.js" ||
    (target.includes("windows-computer-use-mcp") && target.endsWith("/bundle/index.js"))
  )
}
