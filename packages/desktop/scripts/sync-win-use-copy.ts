#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

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
  "opencode.jsonc",
  "state",
])

async function clearDirectory(target: string) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(target, { withFileTypes: true }).catch(() => [])) {
    await rm(path.join(target, entry.name), { recursive: true, force: true })
  }
}

async function copyDirectoryContents(source: string, target: string) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(path.join(source, entry.name), path.join(target, entry.name), {
      force: true,
      recursive: entry.isDirectory(),
    })
  }
}

async function assertSyncedFile(source: string, target: string) {
  const [sourceStat, targetStat] = await Promise.all([Bun.file(source).stat(), Bun.file(target).stat()])
  if (sourceStat.size !== targetStat.size) {
    throw new Error(`Synced file size mismatch: ${target} (${targetStat.size}) != ${source} (${sourceStat.size})`)
  }
}

if (process.platform !== "win32") process.exit(0)
if (!existsSync(sourceDir)) throw new Error(`Packaged Windows app not found: ${sourceDir}`)

await mkdir(targetDir, { recursive: true })

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
  await cp(source, target, {
    force: true,
    recursive: entry.isDirectory(),
  })
}

await assertSyncedFile(path.join(sourceDir, "Lfcode.exe"), path.join(targetDir, "Lfcode.exe"))
await assertSyncedFile(path.join(sourceDir, "resources", "app.asar"), path.join(targetDir, "resources", "app.asar"))

console.log(`Synced packaged Windows app from ${sourceDir} to ${targetDir}`)
