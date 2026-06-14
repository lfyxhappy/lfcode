#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const desktopRoot = path.resolve(import.meta.dir, "..")
const distConfig = path.join(desktopRoot, "dist", "win-unpacked", "opencode.jsonc")
const localConfigDir = path.join(desktopRoot, "local-config")
const localConfig = path.join(localConfigDir, "opencode.jsonc")

if (process.platform !== "win32") process.exit(0)
if (!existsSync(distConfig)) process.exit(0)

function sanitizeSecrets(text: string) {
  return text.replace(
    /("(?:(?:api[_-]?key)|token|secret|password|credential|authorization)"\s*:\s*)"[^"]*"/gi,
    '$1""',
  )
}

await mkdir(localConfigDir, { recursive: true })
const content = await readFile(distConfig, "utf8")
await writeFile(localConfig, sanitizeSecrets(content))
console.log(`Synced packaged config into local template without secrets: ${localConfig}`)
