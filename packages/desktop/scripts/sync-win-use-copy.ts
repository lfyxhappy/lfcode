#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const distDir = path.resolve(import.meta.dir, "../dist")
const sourceDir = path.join(distDir, "win-unpacked")
const targetDir = path.resolve(Bun.env.LFCODE_USE_COPY_DIR ?? path.join(process.env.USERPROFILE ?? "", ".lfcode"))
const replacedDirectories = ["locales", "resources"]
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

async function clearDirectory(target: string) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(target, { withFileTypes: true }).catch(() => [])) {
    await rm(path.join(target, entry.name), { recursive: true, force: true })
  }
}

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

async function assertSyncedFile(source: string, target: string) {
  const [sourceStat, targetStat] = await Promise.all([Bun.file(source).stat(), Bun.file(target).stat()])
  if (sourceStat.size !== targetStat.size) {
    throw new Error(`Synced file size mismatch: ${target} (${targetStat.size}) != ${source} (${sourceStat.size})`)
  }
}

async function upgradeBundledConfig(target: string) {
  if (!existsSync(target)) return
  const text = await Bun.file(target).text()
  const upgraded = upgradeBundledCommands(text)
  if (upgraded !== text) await Bun.write(target, upgraded)
}

if (process.platform !== "win32") process.exit(0)
if (!existsSync(sourceDir)) throw new Error(`Packaged Windows app not found: ${sourceDir}`)

await mkdir(targetDir, { recursive: true })
// Only Lfcode configuration is supported in the use-copy. Clear the former
// compatibility file rather than preserving it or copying it from a package.
await rm(path.join(targetDir, "opencode.jsonc"), { force: true })
for (const directory of replacedDirectories) {
  await clearDirectory(path.join(targetDir, directory))
}

for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (skippedEntries.has(entry.name)) continue
  const source = path.join(sourceDir, entry.name)
  const target = path.join(targetDir, entry.name)
  if (replacedDirectories.includes(entry.name)) {
    await copyDirectoryContents(source, target)
    continue
  }
  await copyEntry(source, target, entry.isDirectory())
}

await assertSyncedFile(path.join(sourceDir, "Lfcode.exe"), path.join(targetDir, "Lfcode.exe"))
await assertSyncedFile(path.join(sourceDir, "resources", "app.asar"), path.join(targetDir, "resources", "app.asar"))
await upgradeBundledConfig(path.join(targetDir, "lfcode.jsonc"))

console.log(`Synced packaged Windows app from ${sourceDir} to ${targetDir}`)

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
