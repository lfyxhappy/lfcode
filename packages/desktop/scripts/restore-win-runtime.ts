#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const distDir = path.resolve(import.meta.dir, "../dist")
const targetDir = path.join(distDir, "win-unpacked")
const backupDir = path.join(distDir, ".win-unpacked-runtime")
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
  "\"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js\"",
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

if (process.platform !== "win32") process.exit(0)
if (!existsSync(targetDir) || !existsSync(backupDir)) process.exit(0)

for (const entry of await readdir(backupDir, { withFileTypes: true })) {
  await cp(path.join(backupDir, entry.name), path.join(targetDir, entry.name), {
    force: true,
    recursive: true,
  })
}

const configFile = path.join(targetDir, "lfcode.jsonc")
if (existsSync(configFile)) {
  const text = await Bun.file(configFile).text()
  const upgraded = upgradeBundledCommands(text)
  if (upgraded !== text) await Bun.write(configFile, upgraded)
}

await rm(backupDir, { recursive: true, force: true })
console.log(`Restored preserved Windows runtime data into ${targetDir}`)

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
  if (isLegacyPlaywrightConfig(playwright) || isPlaywrightCdpConfig(playwright) || isStaleBundledPlaywrightRemoteConfig(playwright)) {
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
  const value = mcp["windows-computer-use"]
  if (value === undefined || isLegacyWindowsComputerUseConfig(value)) {
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

function isLegacyWindowsComputerUseConfig(value: unknown) {
  return (
    isRecord(value) &&
    value.type === "local" &&
    value.enabled === true &&
    (
      isExactCommand(value.command, windowsComputerUsePreviousCommand) ||
      isExactCommand(value.command, windowsComputerUseLegacyCommand) ||
      isBrokenWindowsComputerUseCommand(value.command)
    )
  )
}

function isExactCommand(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
}

function isLegacyPlaywrightConfig(value: unknown) {
  return isRecord(value) && value.type === "local" && value.enabled === true && isExactCommand(value.command, playwrightLegacyCommand)
}

function isPlaywrightCdpConfig(value: unknown) {
  return isRecord(value) && value.type === "local" && value.enabled === true && isExactCommand(value.command, playwrightCdpCommand)
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
