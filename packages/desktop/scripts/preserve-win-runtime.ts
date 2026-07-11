#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const distDir = path.resolve(import.meta.dir, "../dist")
const sourceDir = path.join(distDir, "win-unpacked")
const backupDir = path.join(distDir, ".win-unpacked-runtime")
const entries = ["cache", "data", "state", "config.json", "lfcode.json", "lfcode.jsonc"]

if (process.platform !== "win32") process.exit(0)

await rm(backupDir, { recursive: true, force: true })
if (!existsSync(sourceDir)) process.exit(0)

let copied = 0
for (const entry of entries) {
  const source = path.join(sourceDir, entry)
  if (!existsSync(source)) continue
  await mkdir(path.dirname(path.join(backupDir, entry)), { recursive: true })
  await cp(source, path.join(backupDir, entry), { force: true, recursive: true })
  copied += 1
}

if (copied === 0) {
  await rm(backupDir, { recursive: true, force: true })
  process.exit(0)
}

console.log(`Preserved Windows runtime data from ${sourceDir} into ${backupDir}`)
