#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, readdir, rm } from "node:fs/promises"
import path from "node:path"

const distDir = path.resolve(import.meta.dir, "../dist")
const targetDir = path.join(distDir, "win-unpacked")
const backupDir = path.join(distDir, ".win-unpacked-runtime")

if (process.platform !== "win32") process.exit(0)
if (!existsSync(targetDir) || !existsSync(backupDir)) process.exit(0)

for (const entry of await readdir(backupDir, { withFileTypes: true })) {
  await cp(path.join(backupDir, entry.name), path.join(targetDir, entry.name), {
    force: true,
    recursive: true,
  })
}

await rm(backupDir, { recursive: true, force: true })
console.log(`Restored preserved Windows runtime data into ${targetDir}`)
