#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

const distDir = path.resolve(import.meta.dir, "../dist")
const targetDir = path.join(distDir, "win-unpacked")
const backupDir = path.join(distDir, ".win-unpacked-runtime")
const windowsComputerUseLegacyCommand = [
  "cmd",
  "/c",
  "node",
  "\"%LFCODE_CONFIG_DIR%\\resources\\mcp\\windows-computer-use-mcp\\bundle\\index.js\"",
] as const
const windowsComputerUseCommand = ["node", "{env:LFCODE_WINDOWS_COMPUTER_USE_MCP_DIR}/bundle/index.js"] as const

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
  const upgraded = upgradeWindowsComputerUseCommand(text)
  if (upgraded !== text) await Bun.write(configFile, upgraded)
}

await rm(backupDir, { recursive: true, force: true })
console.log(`Restored preserved Windows runtime data into ${targetDir}`)

function upgradeWindowsComputerUseCommand(text: string) {
  const parsed = parseJsonc(text)
  if (!isRecord(parsed) || !isRecord(parsed.mcp)) return text
  const value = parsed.mcp["windows-computer-use"]
  if (!isLegacyWindowsComputerUseConfig(value)) return text
  return applyEdits(
    text,
    modify(text, ["mcp", "windows-computer-use", "command"], windowsComputerUseCommand, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isLegacyWindowsComputerUseConfig(value: unknown) {
  return (
    isRecord(value) &&
    value.type === "local" &&
    value.enabled === true &&
    (isExactCommand(value.command, windowsComputerUseLegacyCommand) || isBrokenWindowsComputerUseCommand(value.command))
  )
}

function isExactCommand(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
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
